import "dotenv/config";
import { createApp } from "./app.mjs";
const port = Number(process.env.PORT) || 8787;
createApp().listen(port, "127.0.0.1", () =>
  console.log(`穷鬼地图 API / production: http://127.0.0.1:${port}`),
);
