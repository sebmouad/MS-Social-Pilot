<?php
/**
 * Plugin Name: MS Social Pilot REST Fields
 * Description: Read-only exposure of the post meta used by the MS Social Pilot WordPress connector
 *              (Facebook caption, generated image, recipe JSON, already-shared marker) in /wp-json/wp/v2/.
 * Version:     1.0.0
 *
 * Install: copy this file to wp-content/mu-plugins/. Nothing is writable through REST: meta stays
 * editable only by users who could already edit the post (auth_callback). Override the key list with
 * the `ms_social_pilot_rest_meta_keys` filter if your site uses different meta keys.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'init', static function () {
	$keys = apply_filters( 'ms_social_pilot_rest_meta_keys', array(
		'_msrwa_facebook_caption'   => 'string',
		'_msrwa_facebook_generated' => 'string',
		'_msrwa_recipe'             => 'string',
		'fb_shared_at'              => 'string',
	) );
	$post_types = apply_filters( 'ms_social_pilot_rest_post_types', array( 'post' ) );
	foreach ( $post_types as $post_type ) {
		foreach ( $keys as $key => $type ) {
			register_post_meta( $post_type, $key, array(
				'type'          => $type,
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => static function ( $allowed, $meta_key, $post_id ) {
					return current_user_can( 'edit_post', $post_id );
				},
			) );
		}
	}
}, 20 );
