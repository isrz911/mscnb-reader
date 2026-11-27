# mscnb-reader

Static web reader for encrypted data files. The site holds no data and no keys: a person loads a data file from
storage they already have access to, and the key comes with a personal access link (in the URL fragment, which the
browser never sends to any server). The file is checked (HMAC-SHA256) and decrypted (AES-256-CBC, gzip) in the browser
and kept on the device for use without network.

Built from a private repository; changes here are overwritten.
