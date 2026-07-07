import { buildApp } from "./app";
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`hanoman api :${port}`));
