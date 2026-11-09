<?php
/**
 * Ibtekr Operation System — abandoned carts feed (phase 12 T7, docs/superpowers/plans/2026-11-08-phase-12-followups.md decisions 7 / 13).
 *
 * A WPCode PHP snippet («Run Everywhere») for the shop. It adds ONE read-only REST route the system's woo-sync pulls every 10 minutes:
 *
 *   GET /wp-json/ibtekr/v1/carts?hours=48
 *
 * and answers with the carts the free «Cart Abandonment Recovery for WooCommerce» plugin (CartFlows) saved in its table
 * {prefix}cartflows_ca_cart_abandonment — the checkout fields a visitor typed before paying (e-mail, phone, name), the cart total and
 * item count, when the row last changed, the plugin's status (normal = still abandoned · completed · lost) and the plugin's own
 * recovery link (the checkout page with wcf_ac_token). No cart contents, no addresses, no coupon codes leave the site.
 *
 * Authentication: the same WooCommerce REST API keys woo-sync already uses (HTTP Basic over HTTPS, or ?consumer_key=&consumer_secret=
 * like WooCommerce accepts), checked the way WooCommerce checks them: the key's wc_api_hash() against {prefix}woocommerce_api_keys,
 * the secret with hash_equals, the key's permissions must allow reading, and the key's user must still exist. Nothing else may read
 * the route — a signed-in WordPress user without the keys gets 401, and the route never writes.
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
		),
	) );
} );

/**
 * The WooCommerce REST keys from the request (Basic auth first, then the query like WC does) → true when a readable key matches.
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
	if ( ! $user ) {
		return new WP_Error( 'ibtekr_forbidden', 'The key has no user.', array( 'status' => 403 ) );
	}
	return true;
}

/**
 * The abandoned carts of the last N hours as the system reads them (no cart contents).
 *
 * @param WP_REST_Request $request The request.
 * @return WP_REST_Response|WP_Error
 */
function ibtekr_ops_carts_list( $request ) {
	global $wpdb;
	$table = $wpdb->prefix . 'cartflows_ca_cart_abandonment';
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
		return new WP_Error( 'ibtekr_no_cartflows', 'Cart Abandonment Recovery (CartFlows) is not installed.', array( 'status' => 404 ) );
	}
	$hours = max( 1, min( 168, (int) $request->get_param( 'hours' ) ) );
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT id, email, cart_contents, cart_total, session_id, other_fields, order_status, checkout_id, time, unsubscribed
		 FROM {$table} WHERE time >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL %d HOUR) ORDER BY time DESC LIMIT 500", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$hours
	) );
	$out = array();
	foreach ( (array) $rows as $r ) {
		$fields = maybe_unserialize( $r->other_fields );
		$fields = is_array( $fields ) ? $fields : array();
		$cart   = maybe_unserialize( $r->cart_contents );
		$items  = 0;
		if ( is_array( $cart ) ) {
			foreach ( $cart as $line ) {
				$items += isset( $line['quantity'] ) ? max( 0, (int) $line['quantity'] ) : 1;
			}
		}
		$name  = trim( ( isset( $fields['wcf_first_name'] ) ? (string) $fields['wcf_first_name'] : '' ) . ' ' . ( isset( $fields['wcf_last_name'] ) ? (string) $fields['wcf_last_name'] : '' ) );
		$phone = isset( $fields['wcf_phone_number'] ) ? (string) $fields['wcf_phone_number'] : '';
		$url   = '';
		if ( 'normal' === (string) $r->order_status && $r->checkout_id && $r->session_id ) {
			$page = get_permalink( (int) $r->checkout_id );
			$url  = $page ? add_query_arg( 'wcf_ac_token', rawurlencode( (string) $r->session_id ), $page ) : '';
		}
		$out[] = array(
			'id'           => (int) $r->id,
			'email'        => sanitize_email( (string) $r->email ),
			'phone'        => preg_replace( '/[^0-9+]/', '', $phone ),
			'name'         => mb_substr( $name, 0, 120 ),
			'total'        => round( (float) $r->cart_total, 2 ),
			'items'        => $items,
			'status'       => in_array( (string) $r->order_status, array( 'normal', 'completed', 'lost' ), true ) ? (string) $r->order_status : 'normal',
			'unsubscribed' => (bool) $r->unsubscribed,
			'updated_at'   => gmdate( 'c', strtotime( $r->time . ' UTC' ) ),
			'url'          => $url,
		);
	}
	$res = new WP_REST_Response( $out, 200 );
	$res->header( 'Cache-Control', 'no-store' );
	return $res;
}
