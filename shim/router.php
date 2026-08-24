<?php
/**
 * PHP Studio — preview router.
 * Run with:  php -S 127.0.0.1:<port> router.php
 * Env:
 *   PS_DOCROOT  — project folder (static assets served from here)
 *   PS_TARGET   — instrumented copy of the file being previewed
 *   PS_SHIMDIR  — this directory (for inspector.js)
 *
 * Auto-detects file kind:
 *  - Page template: prints a full HTML document itself → passed through.
 *  - Shortcode plugin: registers shortcodes, prints ~nothing → wrapped in a
 *    scaffold document that runs the WP lifecycle and renders the shortcode.
 */

error_reporting( E_ALL & ~E_DEPRECATED );
ini_set( 'display_errors', '1' );

$docroot = getenv( 'PS_DOCROOT' ) ?: getcwd();
$target  = getenv( 'PS_TARGET' );
$shimdir = getenv( 'PS_SHIMDIR' ) ?: __DIR__;

/* Control file lets the host switch preview targets without restarting us */
$ctrl = getenv( 'PS_CTRL' );
if ( $ctrl && is_file( $ctrl ) ) {
    $t = trim( (string) file_get_contents( $ctrl ) );
    if ( $t !== '' ) $target = $t;
}

$uri  = urldecode( parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) );

/* Session token: only the editor (which knows the token) may talk to us. */
$ps_token = getenv( 'PS_TOKEN' );
if ( $ps_token ) {
    $via_header = isset( $_SERVER['HTTP_X_PS_TOKEN'] ) && hash_equals( $ps_token, (string) $_SERVER['HTTP_X_PS_TOKEN'] );
    $via_query  = isset( $_GET['pstoken'] ) && hash_equals( $ps_token, (string) $_GET['pstoken'] );
    $via_cookie = isset( $_COOKIE['pstoken'] ) && hash_equals( $ps_token, (string) $_COOKIE['pstoken'] );
    if ( $via_query && ! $via_cookie ) {
        setcookie( 'pstoken', $ps_token, 0, '/' ); // external browsers ride the cookie
    }
    if ( ! $via_header && ! $via_query && ! $via_cookie ) {
        http_response_code( 403 );
        header( 'Content-Type: text/plain' );
        echo 'Forbidden';
        return true;
    }
}

/* Inspector script */
if ( $uri === '/__psinspector.js' ) {
    header( 'Content-Type: application/javascript' );
    readfile( $shimdir . '/inspector.js' );
    return true;
}

/* Static assets from the project folder */
$asset = realpath( $docroot . $uri );
if ( $uri !== '/' && $asset && is_file( $asset ) && strpos( $asset, realpath( $docroot ) ) === 0
     && ! preg_match( '/\.php$/i', $asset ) ) {
    return false; // let the built-in server serve it
}

if ( ! $target || ! is_file( $target ) ) {
    header( 'Content-Type: text/html; charset=utf-8' );
    echo '<!doctype html><html><body style="font-family:Segoe UI,sans-serif;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:40px;margin-bottom:12px">&#9673;</div>No file selected for preview</div></body></html>';
    return true;
}

require $shimdir . '/wp-shim.php';

/* Capture PHP fatals/parse errors as a friendly error page */
register_shutdown_function( function () {
    $e = error_get_last();
    if ( $e && in_array( $e['type'], array( E_ERROR, E_PARSE, E_COMPILE_ERROR, E_CORE_ERROR ), true ) ) {
        while ( ob_get_level() ) ob_end_clean();
        http_response_code( 500 );
        header( 'X-PS-PHP-Error: 1' );
        $msg  = htmlspecialchars( $e['message'], ENT_QUOTES );
        $file = htmlspecialchars( basename( $e['file'] ), ENT_QUOTES );
        echo '<!doctype html><html><head><meta charset="utf-8"><title>PHP Error</title></head>'
           . '<body style="font-family:Segoe UI,Consolas,monospace;background:#1e1e1e;color:#eee;padding:40px;margin:0">'
           . '<div style="max-width:720px;margin:0 auto">'
           . '<div style="color:#f48771;font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px">PHP Error</div>'
           . '<div style="font-size:15px;line-height:1.6;background:#2a2a2a;border-left:3px solid #f48771;padding:16px 20px;border-radius:6px;white-space:pre-wrap">' . $msg . '</div>'
           . '<div style="color:#888;font-size:12px;margin-top:10px">' . $file . ' &nbsp;·&nbsp; line ' . (int) $e['line'] . '</div>'
           . '</div><script>try{parent.postMessage({ps:"php-error",message:' . json_encode( $e['message'] ) . ',line:' . (int) $e['line'] . '},"*")}catch(e){}</script></body></html>';
    }
} );

/* WP-ish lifecycle begins */
$GLOBALS['ps_is_404'] = false;

ob_start();
$ps_ret = include $target;
$ps_out = ob_get_clean();

$has_shortcodes = ! empty( $GLOBALS['ps_shortcodes'] );
$printed_doc    = stripos( $ps_out, '<html' ) !== false || strlen( trim( $ps_out ) ) > 400;

if ( ! $printed_doc && $has_shortcodes ) {
    /* Shortcode-plugin mode: scaffold a page around the first shortcode */
    $tags = array_keys( $GLOBALS['ps_shortcodes'] );
    $tag  = $tags[0];
    $GLOBALS['post']->post_content = '[' . $tag . ']';

    do_action( 'init' );
    do_action( 'wp' );
    do_action( 'template_redirect' );

    ob_start();
    ?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<?php echo do_shortcode( $GLOBALS['post']->post_content ); ?>
<?php wp_footer(); ?>
</body>
</html>
    <?php
    $ps_out = ob_get_clean();
} elseif ( ! $printed_doc ) {
    /* Fragment: wrap so it is at least viewable */
    $ps_out = "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"></head><body>" . $ps_out . '</body></html>';
}

/* Inject inspector before </body> */
$inject = '<script src="/__psinspector.js"></script>';
if ( stripos( $ps_out, '</body>' ) !== false ) {
    $ps_out = preg_replace( '/<\/body>/i', $inject . '</body>', $ps_out, 1 );
} else {
    $ps_out .= $inject;
}

header( 'Content-Type: text/html; charset=utf-8' );
echo $ps_out;
return true;
