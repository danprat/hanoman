// Each entry is a package dir so vitest can apply its own environment
// (server: node + sequential DB; src: jsdom).
export default ["shared", "server", "src"];
