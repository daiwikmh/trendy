import dotenv from "dotenv";

// .env.local wins over .env (dotenv does not override already-set vars).
dotenv.config({ path: ".env.local" });
dotenv.config();
