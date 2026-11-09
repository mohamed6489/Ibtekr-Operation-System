<?php
/**
 * Ibtekr Operation System — abandoned carts feed (phase 12 T7, docs/superpowers/plans/2026-11-08-phase-12-followups.md decisions 7 / 13).
 *
 * A WPCode PHP snippet («Run Everywhere») for the shop. It adds ONE read-only REST route the system's woo-sync pulls every 10 minutes:
 *
 *   GET /wp-json/ibtekr/v1/carts?hours=48            the carts of the last N hours (default 48, at most 168)
 *   GET /wp-json/ibtekr/v1/carts?probe=1             what the site has: the abandoned-cart tables found and their columns (no rows)
 *
 * The source is whatever the shop keeps abandoned carts in — found at runtime, no configuration:
 *   • WoodMart's built-in «Abandoned cart» (Theme Settings → Shop → Abandoned cart; WoodMart 8.1+) — its table under the WP prefix
 *     whose name contains «abandoned» (woodmart_abandoned_carts on the versions we know), or
 *   • the free «Cart Abandonment Recovery for WooCommerce» (CartFlows) — {prefix}cartflows_ca_cart_abandonment.
 * Each row answers with: id + source (woodmart | cartflows — the system keys a cart by both), email, phone, name, total, item count, status (normal = still abandoned · completed · lost), unsubscribed,
 * when the row last changed, and the plugin's recovery link when the plugin has one the system knows (CartFlows' wcf_ac_token).
 * Columns are mapped by name (see ibtekr_ops_carts_map); a column the table lacks answers empty. WoodMart's «open» carts (a visitor
 * still shopping) are not carts yet and are left out; only its «abandoned» ones count. No cart contents, no addresses, no coupons leave
 * the site.
 *
 * Authentication: the same WooCommerce REST API keys woo-sync already uses (HTTP Basic over HTTPS, or ?consumer_key=&consumer_secret=
 * like WooCommerce accepts), checked the way WooCommerce checks them: the key's wc_api_hash() against {prefix}woocommerce_api_keys,
 * the secret with hash_equals, the key's permissions must allow reading, and the key's user must exist and be able to manage
 * WooCommerce (manage_woocommerce — the system's key is the admin's; a vendor's key is refused). Nothing else may read the route —
 * a signed-in WordPress user without the keys gets 401, and the route never writes.
 *
 * Nothing is sent anywhere from the site: the system pulls. Remove the snippet and the route is gone.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ibtekr/v1', '/carts', array(
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'ibtekr_ops_carts_list',
		'permission_callback' => 'ibtekr_ops_carts_permission',
		'args'                => array(
			'hours' => array( 'type' => 'integer', 'default' => 48, 'minimum' => 1, 'maximum' => 168, 'sanitize_callback' => 'absint' ),
			'probe' => array( 'type' => 'integer', 'default' => 0, 'sanitize_callback' => 'absint' ),
		),
	) );
} );

/**
 * The WooCommerce REST keys from the request (Basic auth first, then the query like WC does) → true when a readable key of a shop
 * manager matches.
 *
 * @param WP_REST_Request $request The request.
 * @return bool|WP_Error
 */
function ibtekr_ops_carts_permission( $request ) {
	if ( ! function_exists( 'wc_api_hash' ) ) {
		return new WP_Error( 'ibtekr_no_woocommerce', 'WooCommerce is not active.', array( 'status' => 503 ) );
	}
	$key    = '';
	$secret = '';
	if ( ! empty( $_SERVER['PHP_AUTH_USER'] ) && ! empty( $_SERVER['PHP_AUTH_PW'] ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$key    = (string) wp_unslash( $_SERVER['PHP_AUTH_USER'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$secret = (string) wp_unslash( $_SERVER['PHP_AUTH_PW'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	} elseif ( ! empty( $_SERVER['HTTP_AUTHORIZATION'] ) && 0 === stripos( (string) $_SERVER['HTTP_AUTHORIZATION'], 'Basic ' ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		// some hosts hand the header through without filling PHP_AUTH_*
		$pair = base64_decode( substr( (string) wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ), 6 ), true ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( is_string( $pair ) && false !== strpos( $pair, ':' ) ) {
			list( $key, $secret ) = explode( ':', $pair, 2 );
		}
	} elseif ( is_ssl() && $request->get_param( 'consumer_key' ) && $request->get_param( 'consumer_secret' ) ) {
		$key    = (string) $request->get_param( 'consumer_key' );
		$secret = (string) $request->get_param( 'consumer_secret' );
	}
	$key    = trim( $key );
	$secret = trim( $secret );
	if ( '' === $key || '' === $secret || 0 !== strpos( $key, 'ck_' ) || 0 !== strpos( $secret, 'cs_' ) ) {
		return new WP_Error( 'ibtekr_unauthorized', 'WooCommerce REST API keys required.', array( 'status' => 401 ) );
	}
	global $wpdb;
	$row = $wpdb->get_row( $wpdb->prepare( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		"SELECT key_id, user_id, permissions, consumer_secret FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s LIMIT 1",
		wc_api_hash( $key )
	) );
	if ( ! $row || ! hash_equals( (string) $row->consumer_secret, $secret ) ) {
		return new WP_Error( 'ibtekr_unauthorized', 'WooCommerce REST API keys required.', array( 'status' => 401 ) );
	}
	if ( ! in_array( (string) $row->permissions, array( 'read', 'read_write' ), true ) ) {
		return new WP_Error( 'ibtekr_forbidden', 'The key cannot read.', array( 'status' => 403 ) );
	}
	$user = get_user_by( 'id', (int) $row->user_id );
	if ( ! $user || ! user_can( $user, 'manage_woocommerce' ) ) {
		// the system's key belongs to a shop manager / admin; a key of a lesser user (a vendor's, say) cannot read the carts
		return new WP_Error( 'ibtekr_forbidden', 'The key\'s user cannot manage the shop.', array( 'status' => 403 ) );
	}
	return true;
}

/**
 * The abandoned-cart tables the site has (under the WP prefix, name containing «abandon») with their columns.
 *
 * @return array<int, array{table: string, columns: string[]}>
 */
function ibtekr_ops_carts_tables() {
	global $wpdb;
	$out  = array();
	$like = $wpdb->esc_like( $wpdb->prefix ) . '%abandon%';
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$names = $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $like ) );
	foreach ( (array) $names as $t ) {
		if ( ! preg_match( '/^[A-Za-z0-9_]+$/', (string) $t ) ) {
			continue;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$cols  = $wpdb->get_col( "SHOW COLUMNS FROM `{$t}`", 0 );
		$out[] = array( 'table' => (string) $t, 'columns' => array_map( 'strval', (array) $cols ) );
	}
	return $out;
}

/**
 * Which column of the table plays each role, by name (the first match wins); null = the table has no such column.
 *
 * @param string[] $cols The table's columns.
 * @return array<string, string|null>
 */
function ibtekr_ops_carts_map( $cols ) {
	$lower = array();
	foreach ( $cols as $c ) {
		$lower[ strtolower( $c ) ] = $c;
	}
	$pick = function ( $names ) use ( $lower ) {
		foreach ( $names as $n ) {
			if ( isset( $lower[ $n ] ) ) {
				return $lower[ $n ];
			}
		}
		return null;
	};
	return array(
		'id'       => $pick( array( 'id', 'cart_id' ) ),
		'email'    => $pick( array( 'email', 'user_email', 'billing_email', 'customer_email' ) ),
		'phone'    => $pick( array( 'phone', 'billing_phone', 'user_phone', 'customer_phone', 'tel' ) ),
		'first'    => $pick( array( 'first_name', 'billing_first_name', 'user_first_name', 'name', 'customer_name' ) ),
		'last'     => $pick( array( 'last_name', 'billing_last_name', 'user_last_name' ) ),
		'fields'   => $pick( array( 'other_fields', 'user_data', 'customer_data', 'billing' ) ),
		'contents' => $pick( array( 'cart_contents', 'cart', 'items', 'products' ) ),
		'total'    => $pick( array( 'cart_total', 'total', 'subtotal', 'amount' ) ),
		'status'   => $pick( array( 'order_status', 'status', 'cart_status' ) ),
		'unsub'    => $pick( array( 'unsubscribed', 'unsubscribe' ) ),
		'time'     => $pick( array( 'time', 'updated_date_gmt', 'updated_at', 'date_modified_gmt', 'modified', 'updated', 'abandoned_date_gmt', 'date_abandoned', 'created_date_gmt', 'created_at', 'date_created_gmt', 'created' ) ),
		'token'    => $pick( array( 'session_id', 'cart_hash', 'hash', 'token', 'cart_key', 'cart_token' ) ),
		'checkout' => $pick( array( 'checkout_id' ) ),
	);
}

/**
 * The plugin's status → the system's: normal (still abandoned) · completed · lost; '' = not a cart yet (WoodMart's «open»).
 *
 * @param string $s The row's status.
 * @return string
 */
function ibtekr_ops_carts_status( $s ) {
	$s = strtolower( trim( (string) $s ) );
	if ( in_array( $s, array( 'normal', 'abandoned', 'pending', 'sent', 'reminded' ), true ) ) {
		return 'normal';
	}
	if ( in_array( $s, array( 'completed', 'recovered', 'converted', 'ordered', 'purchased', 'complete' ), true ) ) {
		return 'completed';
	}
	if ( in_array( $s, array( 'lost', 'expired', 'cancelled', 'canceled', 'deleted', 'unsubscribed' ), true ) ) {
		return 'lost';
	}
	if ( in_array( $s, array( 'open', 'active', 'live', 'in_progress' ), true ) ) {
		return '';
	}
	return 'normal';
}

/**
 * A serialized / JSON column → an array, with no object ever built (unserialize with allowed_classes false; the rows come from a
 * table found at runtime, so nothing in them is trusted).
 *
 * @param mixed $raw The column value.
 * @return array
 */
function ibtekr_ops_carts_decode( $raw ) {
	if ( is_array( $raw ) ) {
		return $raw;
	}
	if ( ! is_string( $raw ) || '' === $raw ) {
		return array();
	}
	if ( is_serialized( $raw ) ) {
		$data = @unserialize( $raw, array( 'allowed_classes' => false ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_unserialize,WordPress.PHP.NoSilencedErrors.Discouraged
		return is_array( $data ) ? $data : array();
	}
	$json = json_decode( $raw, true );
	return is_array( $json ) ? $json : array();
}

/**
 * A value of a (possibly serialized / JSON) fields column, by the keys we know.
 *
 * @param mixed    $raw  The column value.
 * @param string[] $keys The keys to look for, in order.
 * @return string
 */
function ibtekr_ops_carts_field( $raw, $keys ) {
	$data = ibtekr_ops_carts_decode( $raw );
	foreach ( $keys as $k ) {
		if ( isset( $data[ $k ] ) && is_scalar( $data[ $k ] ) ) {
			return (string) $data[ $k ];
		}
	}
	return '';
}

/**
 * How many pieces a serialized / JSON cart holds (quantities summed; a line without one counts 1).
 *
 * @param mixed $raw The contents column.
 * @return int
 */
function ibtekr_ops_carts_items( $raw ) {
	$cart = ibtekr_ops_carts_decode( $raw );
	$n    = 0;
	foreach ( $cart as $line ) {
		$n += is_array( $line ) && isset( $line['quantity'] ) ? max( 0, (int) $line['quantity'] ) : 1;
	}
	return $n;
}

/**
 * The abandoned carts of the last N hours as the system reads them (no contents), or the probe.
 *
 * @param WP_REST_Request $request The request.
 * @return WP_REST_Response|WP_Error
 */
function ibtekr_ops_carts_list( $request ) {
	global $wpdb;
	$tables = ibtekr_ops_carts_tables();
	if ( (int) $request->get_param( 'probe' ) ) {
		$probe = array();
		foreach ( $tables as $t ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$count   = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$t['table']}`" );
			$probe[] = array( 'table' => $t['table'], 'columns' => $t['columns'], 'map' => ibtekr_ops_carts_map( $t['columns'] ), 'rows' => $count );
		}
		$res = new WP_REST_Response( array( 'tables' => $probe, 'woodmart' => function_exists( 'woodmart_get_opt' ) ? (bool) woodmart_get_opt( 'abandoned_cart_enabled' ) : null ), 200 );
		$res->header( 'Cache-Control', 'no-store' );
		return $res;
	}
	if ( empty( $tables ) ) {
		return new WP_Error( 'ibtekr_no_carts_table', 'No abandoned-cart table on this site (WoodMart abandoned cart or CartFlows).', array( 'status' => 404 ) );
	}
	$hours = max( 1, min( 168, (int) $request->get_param( 'hours' ) ) );
	$since = gmdate( 'Y-m-d H:i:s', time() - $hours * HOUR_IN_SECONDS );
	$out   = array();
	foreach ( $tables as $t ) {
		$m = ibtekr_ops_carts_map( $t['columns'] );
		if ( ! $m['id'] || ! $m['time'] ) {
			continue;
		}
		$table = $t['table'];
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `{$table}` WHERE `{$m['time']}` >= %s ORDER BY `{$m['time']}` DESC LIMIT 500", $since ), ARRAY_A );
		$is_cartflows = false !== strpos( $table, 'cartflows' );
		foreach ( (array) $rows as $r ) {
			$status = ibtekr_ops_carts_status( $m['status'] ? $r[ $m['status'] ] : 'normal' );
			if ( '' === $status ) {
				continue; // WoodMart «open»: the visitor is still shopping
			}
			$fields = $m['fields'] ? $r[ $m['fields'] ] : null;
			$email  = $m['email'] ? (string) $r[ $m['email'] ] : '';
			$phone  = $m['phone'] ? (string) $r[ $m['phone'] ] : ibtekr_ops_carts_field( $fields, array( 'wcf_phone_number', 'billing_phone', 'phone' ) );
			$first  = $m['first'] ? (string) $r[ $m['first'] ] : ibtekr_ops_carts_field( $fields, array( 'wcf_first_name', 'billing_first_name', 'first_name', 'name' ) );
			$last   = $m['last'] ? (string) $r[ $m['last'] ] : ibtekr_ops_carts_field( $fields, array( 'wcf_last_name', 'billing_last_name', 'last_name' ) );
			$url    = '';
			if ( 'normal' === $status && $is_cartflows && $m['token'] && $m['checkout'] && $r[ $m['checkout'] ] && $r[ $m['token'] ] ) {
				$page = get_permalink( (int) $r[ $m['checkout'] ] );
				$url  = $page ? add_query_arg( 'wcf_ac_token', rawurlencode( (string) $r[ $m['token'] ] ), $page ) : '';
			}
			$time = (string) $r[ $m['time'] ];
			$ts   = is_numeric( $time ) ? (int) $time : strtotime( $time . ' UTC' );
			$out[] = array(
				'id'           => (int) $r[ $m['id'] ],
				'source'       => $is_cartflows ? 'cartflows' : 'woodmart',
				'email'        => sanitize_email( $email ),
				'phone'        => preg_replace( '/[^0-9+]/', '', $phone ),
				'name'         => mb_substr( trim( $first . ' ' . $last ), 0, 120 ),
				'total'        => $m['total'] ? round( (float) $r[ $m['total'] ], 2 ) : 0,
				'items'        => $m['contents'] ? ibtekr_ops_carts_items( $r[ $m['contents'] ] ) : 0,
				'status'       => $status,
				'unsubscribed' => $m['unsub'] ? (bool) $r[ $m['unsub'] ] : false,
				'updated_at'   => gmdate( 'c', $ts ? $ts : time() ),
				'url'          => $url,
			);
		}
	}
	$res = new WP_REST_Response( $out, 200 );
	$res->header( 'Cache-Control', 'no-store' );
	return $res;
}
