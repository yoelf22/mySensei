// worker/src/worker.mjs
export default {
  async fetch(request, env) {
    return new Response("not found", { status: 404 });
  },
};
