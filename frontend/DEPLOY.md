# Deploy frontend into Spring static
- Dev: backend `./gradlew bootRun` + `npm run dev` (Vite proxy handles /api, /media).
- Prod: `npm run deploy` — builds and copies dist/ into backend/src/main/resources/static/.
- Then `cd backend && ./gradlew bootRun` serves the SPA at http://localhost:8080.
