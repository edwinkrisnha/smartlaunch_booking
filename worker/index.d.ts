// Type of worker/index.js for `wrangler types` (worker-configuration.d.ts imports the
// entry module). Without it, TypeScript would type-check the generated SvelteKit build
// output that index.js imports.
declare const handler: ExportedHandler<Env>;
export default handler;
