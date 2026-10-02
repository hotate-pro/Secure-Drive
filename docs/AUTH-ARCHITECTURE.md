# Secure Drive Authentication Architecture

## Trust model

V0.1 is a local authentication layer. It is intentionally not the final security boundary for Google Drive.

Authentication requires:

1. A registered card QR token.
2. A face embedding match for the user bound to that card.
3. A random multi-step head-turn challenge.

The application never sends the camera frame to a server.

## Stored data

The card contains only a random opaque token.

The browser stores:

- SHA-256(card token)
- user role/status
- 512-dimensional ArcFace embedding
- creation timestamp
- authentication logs

The card token hash and embedding are encrypted with AES-GCM before being stored in IndexedDB.

No face photograph is stored by the application.

## Face pipeline

Camera frame

→ YuNet face detection

→ five landmarks

→ five-point similarity alignment to 112×112 ArcFace template

→ RGB normalization: (pixel - 127.5) / 127.5

→ ArcFace MobileFaceNet

→ 512-dimensional embedding

→ L2 normalization

→ cosine similarity

## Anti-spoofing

V0.1 has challenge-response liveness:

- center
- screen-left
- screen-right

The order is randomized per authentication attempt.

This is deliberately described as basic liveness, not a high-assurance presentation-attack detector. A later version can add a dedicated anti-spoofing model such as MiniFASNet and temporal checks.

## Important browser security boundary

A user who has full control over the browser profile, JavaScript, or the local machine can modify local IndexedDB and application code. Therefore V0.1 must not be treated as proof that an attacker cannot bypass authentication.

For the final Google Drive integration, actual access must also be protected by Google OAuth / Drive permissions and, if stronger protection is required, a server-side or cryptographic authorization layer.

## Threshold

The initial cosine threshold is a prototype value. It must be calibrated against the actual cameras, lighting, users, enrollment samples, and false-accept / false-reject requirements before real deployment.

Never claim biometric authentication is 100% accurate.
