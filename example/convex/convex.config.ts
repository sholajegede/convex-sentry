import { defineApp } from "convex/server";
import convexSentry from "../../src/component/convex.config.js";

const app = defineApp();
app.use(convexSentry);

export default app;
