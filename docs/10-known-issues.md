# GOMROK Known Issues and Limitations

## Non-blocking limitations

1. Live database-backed login, registration approval, cargo mutation, GPS, upload, OTP, POD, and settlement flows were not exercised because local test credentials and a disposable populated MySQL environment were not supplied.
2. The development preview workspaces intentionally render empty/error-safe read models and are unavailable as a production bypass.
3. The process-local real-time broker remains an existing scaling limitation; multiple API instances require shared pub/sub, as documented in the repository README.
4. No external production deployment, DNS change, or production smoke test was authorized.

No known visual or build blocker remains.
