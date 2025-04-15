// File: /api/config/index.js
// Serves your NOVAVISION_KEY to the frontend securely via JS injection

export async function GET() {
  return new Response(
    `window.NOVAVISION_KEY = "${process.env.NOVAVISION_KEY}";`,
    {
      headers: { "Content-Type": "application/javascript" }
    }
  );
}