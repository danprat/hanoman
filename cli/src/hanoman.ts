#!/usr/bin/env node
import { run } from "./router";
const readStdin = () => new Promise<string>((res) => {
  let d = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => res(d));
  if (process.stdin.isTTY) res("");
});
run(process.argv.slice(2), {
  cwd: process.cwd(), env: process.env,
  stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), readStdin,
}).then((code) => process.exit(code));
