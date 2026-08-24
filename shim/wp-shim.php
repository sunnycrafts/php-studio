<?php
/**
 * PHP Studio — minimal WordPress runtime shim.
 * Implements just enough of WP core for single-file themes/templates and
 * shortcode plugins to execute and render in the live preview.
 */

/* ── Globals ─────────────────────────────────────────── */
$GLOBALS['ps_actions']    = array();   // hook => [ [priority, callable], ... ]
$GLOBALS['ps_shortcodes'] = array();   // tag => callable
$GLOBALS['ps_options']    = array();   // in-memory wp_options
$GLOBALS['ps_rewrites']   = array();
$GLOBALS['ps_is_404']     = false;

class WP_Post {
    public $ID = 1;
    public $post_title = 'Preview';
    public $post_content = '';
    public $post_type = 'page';
    public $post_status = 'publish';
    public $post_name = 'preview';
}

/* ── Hooks & filters (shared table, WP-style) ────────── */
function add_action( $hook, $cb, $priority = 10, $args = 1 ) {
    $GLOBALS['ps_actions'][ $hook ][] = array( $priority, $cb, $args );
    return true;
}
function add_filter( $hook, $cb, $priority = 10, $args = 1 ) {
    return add_action( $hook, $cb, $priority, $args );
}
function ps_sorted_hooks( $hook ) {
    if ( empty( $GLOBALS['ps_actions'][ $hook ] ) ) return array();
    $list = $GLOBALS['ps_actions'][ $hook ];
    usort( $list, function ( $a, $b ) { return $a[0] <=> $b[0]; } );
    return $list;
}
function do_action( $hook, ...$args ) {
    foreach ( ps_sorted_hooks( $hook ) as $h ) {
        call_user_func_array( $h[1], array_slice( $args, 0, max( 1, $h[2] ) ) );
    }
}
function apply_filters( $hook, $value, ...$args ) {
    foreach ( ps_sorted_hooks( $hook ) as $h ) {
        $value = call_user_func_array( $h[1], array_merge( array( $value ), array_slice( $args, 0, max( 0, $h[2] - 1 ) ) ) );
    }
    return $value;
}
function remove_action( $hook, $cb, $priority = 10 ) {
    if ( empty( $GLOBALS['ps_actions'][ $hook ] ) ) return false;
    foreach ( $GLOBALS['ps_actions'][ $hook ] as $i => $h ) {
        if ( $h[1] === $cb && $h[0] === $priority ) unset( $GLOBALS['ps_actions'][ $hook ][ $i ] );
    }
    return true;
}
function remove_filter( $hook, $cb, $priority = 10 ) { return remove_action( $hook, $cb, $priority ); }
function has_action( $hook ) { return ! empty( $GLOBALS['ps_actions'][ $hook ] ); }
function has_filter( $hook ) { return has_action( $hook ); }
function __return_false() { return false; }
function __return_true() { return true; }
function __return_empty_string() { return ''; }
function __return_null() { return null; }

/* ── Shortcodes ──────────────────────────────────────── */
function add_shortcode( $tag, $cb ) { $GLOBALS['ps_shortcodes'][ $tag ] = $cb; }
function remove_shortcode( $tag ) { unset( $GLOBALS['ps_shortcodes'][ $tag ] ); }
function shortcode_exists( $tag ) { return isset( $GLOBALS['ps_shortcodes'][ $tag ] ); }
function has_shortcode( $content, $tag ) {
    return is_string( $content ) && strpos( $content, '[' . $tag ) !== false;
}
function shortcode_atts( $defaults, $atts ) {
    $atts = (array) $atts;
    $out  = array();
    foreach ( $defaults as $k => $v ) $out[ $k ] = array_key_exists( $k, $atts ) ? $atts[ $k ] : $v;
    return $out;
}
function do_shortcode( $content ) {
    if ( ! is_string( $content ) || empty( $GLOBALS['ps_shortcodes'] ) ) return $content;
    return preg_replace_callback(
        '/\[([a-zA-Z0-9_\-]+)([^\]]*)\](?:(.*?)\[\/\1\])?/s',
        function ( $m ) {
            $tag = $m[1];
            if ( ! isset( $GLOBALS['ps_shortcodes'][ $tag ] ) ) return $m[0];
            $atts = array();
            if ( preg_match_all( '/([a-zA-Z0-9_\-]+)\s*=\s*"([^"]*)"/', $m[2], $am, PREG_SET_ORDER ) ) {
                foreach ( $am as $a ) $atts[ $a[1] ] = $a[2];
            }
            $inner = isset( $m[3] ) ? $m[3] : null;
            return call_user_func( $GLOBALS['ps_shortcodes'][ $tag ], $atts, $inner, $tag );
        },
        $content
    );
}

/* ── Escaping / sanitizing ───────────────────────────── */
function esc_url( $url ) { return htmlspecialchars( $url, ENT_QUOTES, 'UTF-8' ); }
function esc_url_raw( $url ) { return $url; }
function esc_attr( $t ) { return htmlspecialchars( (string) $t, ENT_QUOTES, 'UTF-8' ); }
function esc_html( $t ) { return htmlspecialchars( (string) $t, ENT_QUOTES, 'UTF-8' ); }
function esc_js( $t ) { return addslashes( (string) $t ); }
function esc_textarea( $t ) { return esc_html( $t ); }
function wp_kses_post( $t ) { return $t; }
function wp_kses( $t, $allowed = array() ) { return $t; }
function sanitize_text_field( $t ) { return trim( strip_tags( (string) $t ) ); }
function sanitize_title( $t ) { return strtolower( preg_replace( '/[^a-z0-9]+/i', '-', (string) $t ) ); }
function sanitize_key( $t ) { return strtolower( preg_replace( '/[^a-z0-9_\-]/', '', (string) $t ) ); }
function __( $t, $domain = 'default' ) { return $t; }
function _e( $t, $domain = 'default' ) { echo $t; }
function esc_html__( $t, $d = 'default' ) { return esc_html( $t ); }
function esc_attr__( $t, $d = 'default' ) { return esc_attr( $t ); }

/* ── URLs ────────────────────────────────────────────── */
function ps_base_url() {
    $host = isset( $_SERVER['HTTP_HOST'] ) ? $_SERVER['HTTP_HOST'] : '127.0.0.1';
    return 'http://' . $host;
}
function home_url( $path = '', $scheme = null ) {
    return ps_base_url() . '/' . ltrim( (string) $path, '/' );
}
function site_url( $path = '', $scheme = null ) { return home_url( $path, $scheme ); }
function admin_url( $path = '' ) { return home_url( 'wp-admin/' . ltrim( $path, '/' ) ); }
function includes_url( $path = '' ) { return home_url( 'wp-includes/' . ltrim( $path, '/' ) ); }
function content_url( $path = '' ) { return home_url( 'wp-content/' . ltrim( $path, '/' ) ); }
function plugins_url( $path = '', $plugin = '' ) { return home_url( 'wp-content/plugins/' . ltrim( $path, '/' ) ); }
/* In preview, plugin assets live at the docroot — resolve to the server root
 * so generated pages' images/ folders load. Real WP resolves this properly. */
function plugin_dir_url( $file ) { return home_url( '/' ); }
function plugin_dir_path( $file ) { return dirname( $file ) . DIRECTORY_SEPARATOR; }
function add_query_arg( $key, $value = null, $url = null ) {
    if ( is_array( $key ) ) { $args = $key; $url = $value ?: ''; }
    else { $args = array( $key => $value ); $url = $url ?: ''; }
    $sep = ( strpos( $url, '?' ) === false ) ? '?' : '&';
    return $url . $sep . http_build_query( $args );
}
function wp_safe_redirect( $loc, $status = 302 ) { header( 'Location: ' . $loc, true, $status ); }
function wp_redirect( $loc, $status = 302 ) { wp_safe_redirect( $loc, $status ); }

/* ── Options ─────────────────────────────────────────── */
function get_option( $name, $default = false ) {
    return array_key_exists( $name, $GLOBALS['ps_options'] ) ? $GLOBALS['ps_options'][ $name ] : $default;
}
function update_option( $name, $value ) { $GLOBALS['ps_options'][ $name ] = $value; return true; }
function add_option( $name, $value = '' ) { return update_option( $name, $value ); }
function delete_option( $name ) { unset( $GLOBALS['ps_options'][ $name ] ); return true; }
function get_transient( $name ) { return get_option( '_transient_' . $name ); }
function set_transient( $name, $value, $exp = 0 ) { return update_option( '_transient_' . $name, $value ); }

/* ── Rewrites / query ────────────────────────────────── */
function add_rewrite_rule( $regex, $query, $after = 'bottom' ) {
    $GLOBALS['ps_rewrites'][] = array( $regex, $query );
}
function flush_rewrite_rules( $hard = true ) {}
function get_query_var( $var, $default = '' ) { return isset( $_GET[ $var ] ) ? $_GET[ $var ] : $default; }
function set_query_var( $var, $value ) { $_GET[ $var ] = $value; }

/* ── Conditionals ────────────────────────────────────── */
function is_404() { return $GLOBALS['ps_is_404']; }
function is_page( $p = '' ) { return true; }
function is_single( $p = '' ) { return false; }
function is_singular( $p = '' ) { return true; }
function is_front_page() { return true; }
function is_home() { return false; }
function is_admin() { return false; }
function is_user_logged_in() { return false; }
function wp_doing_ajax() { return false; }
function current_user_can( $cap ) { return true; }

/* ── Template / output tags ──────────────────────────── */
function language_attributes() { echo 'lang="en-US"'; }
function get_bloginfo( $show = '' ) {
    switch ( $show ) {
        case 'charset':     return 'UTF-8';
        case 'name':        return 'PHP Studio Preview';
        case 'description': return '';
        case 'url': case 'wpurl': return home_url();
        case 'language':    return 'en-US';
        case 'html_type':   return 'text/html';
        default:            return '';
    }
}
function bloginfo( $show = '' ) { echo get_bloginfo( $show ); }
function body_class( $extra = '' ) {
    $classes = array( 'page' );
    foreach ( (array) $extra as $e ) {
        foreach ( preg_split( '/\s+/', (string) $e, -1, PREG_SPLIT_NO_EMPTY ) as $c ) $classes[] = $c;
    }
    $classes = apply_filters( 'body_class', $classes );
    echo 'class="' . esc_attr( implode( ' ', array_unique( $classes ) ) ) . '"';
}
function get_body_class( $extra = '' ) { return array( 'page' ); }
function wp_head() {
    $title = apply_filters( 'pre_get_document_title', '' );
    if ( is_string( $title ) && $title !== '' ) {
        echo '<title>' . esc_html( $title ) . '</title>' . "\n";
    }
    do_action( 'wp_head' );
}
function wp_footer() { do_action( 'wp_footer' ); }
function wp_body_open() { do_action( 'wp_body_open' ); }
function the_title() { global $post; echo $post ? esc_html( $post->post_title ) : ''; }
function get_the_title( $p = 0 ) { global $post; return $post ? $post->post_title : ''; }
function get_the_ID() { global $post; return $post ? $post->ID : 0; }
function the_content() { global $post; echo $post ? do_shortcode( $post->post_content ) : ''; }
function get_permalink( $p = 0 ) { return home_url( '/' ); }
function get_header( $name = null ) {}
function get_footer( $name = null ) {}
function get_sidebar( $name = null ) {}
function get_template_part( $slug, $name = null ) {}
function get_template_directory() { return sys_get_temp_dir(); }
function get_template_directory_uri() { return home_url( 'wp-content/themes/preview' ); }
function get_stylesheet_directory() { return sys_get_temp_dir(); }
function get_stylesheet_directory_uri() { return get_template_directory_uri(); }
function get_stylesheet_uri() { return get_template_directory_uri() . '/style.css'; }

/* ── HTTP / headers ──────────────────────────────────── */
function status_header( $code, $desc = '' ) {
    if ( ! headers_sent() ) http_response_code( (int) $code );
}
function nocache_headers() {
    if ( headers_sent() ) return;
    header( 'Cache-Control: no-cache, must-revalidate, max-age=0' );
    header( 'Expires: Wed, 11 Jan 1984 05:00:00 GMT' );
}
function wp_die( $message = '', $title = '', $args = array() ) {
    echo '<div style="font-family:sans-serif;padding:2rem">' . ( is_string( $message ) ? $message : 'wp_die()' ) . '</div>';
    exit;
}

/* ── Assets (enqueue → collected, emitted on wp_head/footer) ── */
$GLOBALS['ps_styles']  = array();
$GLOBALS['ps_scripts'] = array();
function wp_enqueue_style( $handle, $src = '', $deps = array(), $ver = false, $media = 'all' ) {
    if ( $src ) $GLOBALS['ps_styles'][ $handle ] = $src;
}
function wp_enqueue_script( $handle, $src = '', $deps = array(), $ver = false, $footer = false ) {
    if ( $src ) $GLOBALS['ps_scripts'][ $handle ] = $src;
}
function wp_register_style( $h, $s = '', $d = array(), $v = false, $m = 'all' ) { wp_enqueue_style( $h, $s ); }
function wp_register_script( $h, $s = '', $d = array(), $v = false, $f = false ) { wp_enqueue_script( $h, $s ); }
function wp_add_inline_style( $handle, $css ) { add_action( 'wp_head', function () use ( $css ) { echo '<style>' . $css . '</style>'; }, 20 ); }
function wp_add_inline_script( $handle, $js ) { add_action( 'wp_footer', function () use ( $js ) { echo '<script>' . $js . '</script>'; }, 20 ); }
add_action( 'wp_head', function () {
    foreach ( $GLOBALS['ps_styles'] as $src ) echo '<link rel="stylesheet" href="' . esc_url( $src ) . "\">\n";
}, 9 );
add_action( 'wp_footer', function () {
    foreach ( $GLOBALS['ps_scripts'] as $src ) echo '<script src="' . esc_url( $src ) . "\"></script>\n";
}, 9 );

/* ── Misc ────────────────────────────────────────────── */
function register_activation_hook( $file, $cb ) {}
function register_deactivation_hook( $file, $cb ) {}
function wp_create_nonce( $action = -1 ) { return 'psnonce'; }
function wp_verify_nonce( $nonce, $action = -1 ) { return 1; }
function wp_nonce_field( $a = -1, $n = '_wpnonce', $r = true, $e = true ) { return ''; }
function get_posts( $args = array() ) { return array(); }
function wp_get_attachment_image_url( $id, $size = 'thumbnail' ) { return ''; }
function wp_json_encode( $v, $f = 0 ) { return json_encode( $v, $f ); }
if ( ! function_exists( 'wp_date' ) ) { function wp_date( $fmt, $ts = null ) { return date( $fmt, $ts ?: time() ); } }
function current_time( $type = 'timestamp' ) { return $type === 'timestamp' ? time() : date( $type ); }

/* ── Environment ─────────────────────────────────────── */
if ( ! defined( 'ABSPATH' ) ) define( 'ABSPATH', __DIR__ . DIRECTORY_SEPARATOR );
if ( ! defined( 'WPINC' ) )   define( 'WPINC', 'wp-includes' );

$GLOBALS['post'] = new WP_Post();
