<?php
/**
 * Ibtekr Operation System — the brand picture on the «Product Brand» attribute swatch (the owner 17 Nov:
 * «صورة البراند متتحطش في ال image swatch في ال brand في ال attribute … و هي تمام اتحطت في ال brands بتاعة woocomerce»).
 *
 * A Code Snippets / WPCode PHP snippet («Run Everywhere»). NOT installed yet — the owner decides.
 *
 * Why a snippet: the system writes the brand on the site in two places (woo-sync brand_site / product_save): WooCommerce Brands
 * (product_brand — its picture = term meta thumbnail_id, set over REST) and a term of the «Product Brand» attribute (pa_brand).
 * WoodMart keeps the attribute term's «Image swatch» in the term meta `image`, and no REST route on the shop writes it: the
 * WooCommerce attribute-term route takes name / slug / description / menu_order only, and pa_brand is not a WordPress REST
 * taxonomy (staging-probe PROBE=swatch, 17 Nov). So the shop copies it itself.
 *
 * What it does — nothing else, no route, nothing sent anywhere:
 *   • whenever a WooCommerce brand gets or changes its picture (thumbnail_id), the pa_brand term with the same name — and its WPML
 *     translations — gets that picture as WoodMart's «Image swatch» (term meta `image` = [ 'id' => attachment, 'url' => its URL ]);
 *   • whenever a pa_brand term is made (the system makes it right after the brand), it takes the picture of the brand with its name;
 *   • once, on the first admin page after the snippet is switched on: every brand that already has a picture.
 * A brand without a picture never clears a swatch set by hand. Remove the snippet and nothing more is copied (what was copied stays).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const IBTEKR_SWATCH_FROM = 'product_brand';
const IBTEKR_SWATCH_TO   = 'pa_brand';

/** Every language version of a term id (WPML when it is there, else the term itself). */
function ibtekr_swatch_versions( $term_id, $taxonomy ) {
	$ids = array( (int) $term_id );
	$langs = apply_filters( 'wpml_active_languages', null, array( 'skip_missing' => 0 ) );
	if ( is_array( $langs ) ) {
		foreach ( array_keys( $langs ) as $code ) {
			$t = apply_filters( 'wpml_object_id', (int) $term_id, $taxonomy, false, $code );
			if ( $t ) {
				$ids[] = (int) $t;
			}
		}
	}
	return array_values( array_unique( array_filter( $ids ) ) );
}

/** The term of $taxonomy named like $name, in any language (WPML filters get_term_by by the current one). */
function ibtekr_swatch_find( $name, $taxonomy ) {
	$name = trim( wp_specialchars_decode( (string) $name ) );
	if ( '' === $name ) {
		return null;
	}
	do_action( 'wpml_switch_language', 'all' );
	$found = get_terms( array( 'taxonomy' => $taxonomy, 'name' => $name, 'hide_empty' => false, 'number' => 1, 'suppress_filters' => true ) );
	do_action( 'wpml_switch_language', null );
	return ( is_array( $found ) && $found ) ? $found[0] : null;
}

/** The brand's picture → the swatch of the attribute term with its name (and that term's translations). */
function ibtekr_swatch_copy( $brand_id ) {
	$brand = get_term( (int) $brand_id, IBTEKR_SWATCH_FROM );
	if ( ! $brand || is_wp_error( $brand ) ) {
		return;
	}
	$att = (int) get_term_meta( $brand->term_id, 'thumbnail_id', true );
	if ( ! $att || ! wp_attachment_is_image( $att ) ) {
		return; // no picture: a swatch set by hand stays
	}
	$term = ibtekr_swatch_find( $brand->name, IBTEKR_SWATCH_TO );
	if ( ! $term ) {
		return;
	}
	$value = array( 'id' => $att, 'url' => (string) wp_get_attachment_url( $att ) );
	foreach ( ibtekr_swatch_versions( $term->term_id, IBTEKR_SWATCH_TO ) as $tid ) {
		update_term_meta( $tid, 'image', $value );
	}
}

// the brand's picture set or changed (WooCommerce REST and the admin screen both write thumbnail_id after the term exists)
function ibtekr_swatch_on_meta( $meta_id, $term_id, $key ) {
	if ( 'thumbnail_id' !== $key ) {
		return;
	}
	$t = get_term( (int) $term_id );
	if ( $t && ! is_wp_error( $t ) && IBTEKR_SWATCH_FROM === $t->taxonomy ) {
		ibtekr_swatch_copy( $t->term_id );
	}
}
add_action( 'added_term_meta', 'ibtekr_swatch_on_meta', 20, 3 );
add_action( 'updated_term_meta', 'ibtekr_swatch_on_meta', 20, 3 );
add_action( 'edited_' . IBTEKR_SWATCH_FROM, 'ibtekr_swatch_copy', 20 );

// a new attribute term takes the picture of the brand with its name
add_action( 'created_' . IBTEKR_SWATCH_TO, function ( $term_id ) {
	$t = get_term( (int) $term_id, IBTEKR_SWATCH_TO );
	if ( ! $t || is_wp_error( $t ) ) {
		return;
	}
	$brand = ibtekr_swatch_find( $t->name, IBTEKR_SWATCH_FROM );
	if ( $brand ) {
		ibtekr_swatch_copy( $brand->term_id );
	}
}, 20 );

// once: the brands that already have a picture
add_action( 'admin_init', function () {
	if ( get_option( 'ibtekr_brand_swatch_done' ) || ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}
	update_option( 'ibtekr_brand_swatch_done', time(), false );
	$brands = get_terms( array( 'taxonomy' => IBTEKR_SWATCH_FROM, 'hide_empty' => false, 'fields' => 'ids', 'meta_key' => 'thumbnail_id' ) );
	foreach ( is_array( $brands ) ? $brands : array() as $id ) {
		ibtekr_swatch_copy( (int) $id );
	}
} );
