export async function waitForServer(host) {
  let isServerRunning = false;
  while (!isServerRunning) {
    try {
      const response = await fetch(`${host}/backend`);
      if (response.status != 502) {
        isServerRunning = true;
      } else {
        console.info("Server not available. Retrying connection...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (e) {
      console.info("Server not available. Retrying connection...");
      // Waiting 5 seconds to retry
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
