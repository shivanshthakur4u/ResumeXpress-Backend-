// Vercel's serverless entrypoint. Functions are discovered under api/, which
// is what lets vercel.json set maxDuration for this route — the legacy `builds`
// property cannot be combined with `functions`.
//
// The app itself still lives in ../index.js so local development (npm run dev)
// and self-hosting are unaffected.
export { default } from "../index.js";
