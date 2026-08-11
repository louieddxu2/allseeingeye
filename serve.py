#!/usr/bin/env python3
"""Dev server for the AR app with optional HTTPS self-signed SSL support.

Required for iOS Safari camera and Service Worker testing over local Wi-Fi.
Usage:
  python serve.py 8000          (Standard HTTP)
  python serve.py 8000 --ssl    (HTTPS with self-signed certificate)
"""
import functools
import http.server
import os
import ssl
import sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

def generate_self_signed_cert(cert_file="cert.pem", key_file="key.pem"):
    if os.path.exists(cert_file) and os.path.exists(key_file):
        return
    print("Generating temporary self-signed SSL certificate for local HTTPS testing...")
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, u"localhost")])
        cert = x509.CertificateBuilder().subject_name(
            name
        ).issuer_name(
            name
        ).public_key(
            key.public_key()
        ).serial_number(
            x509.random_serial_number()
        ).not_valid_before(
            datetime.datetime.utcnow()
        ).not_valid_after(
            datetime.datetime.utcnow() + datetime.timedelta(days=365)
        ).sign(key, hashes.SHA256())

        with open(key_file, "wb") as f:
            f.write(key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            ))
        with open(cert_file, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
    except Exception as err:
        print("Could not generate certificate via cryptography library, attempting fallback...", err)

if __name__ == "__main__":
    port = 8000
    use_ssl = "--ssl" in sys.argv
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)

    serve_dir = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=serve_dir)
    httpd = http.server.ThreadingHTTPServer(("", port), handler)

    protocol = "http"
    if use_ssl:
        cert_file = os.path.join(serve_dir, "cert.pem")
        key_file = os.path.join(serve_dir, "key.pem")
        generate_self_signed_cert(cert_file, key_file)
        if os.path.exists(cert_file) and os.path.exists(key_file):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certfile=cert_file, keyfile=key_file)
            httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
            protocol = "https"

    print(f"\n==================================================")
    print(f" Serving {serve_dir}")
    print(f" Local URL:    {protocol}://localhost:{port}")
    print(f" Local Wi-Fi:  {protocol}://192.168.0.11:{port}")
    print(f"==================================================\n")
    httpd.serve_forever()
