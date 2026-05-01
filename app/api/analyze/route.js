// app/api/analyze/route.js
// VoltIQ AI Analysis Backend — uses Google Gemini (free)

export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt) {
      return Response.json({ error: "No prompt provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY missing. Add it to .env.local and Vercel Environment Variables." },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return Response.json(
        { error: "Gemini API error: " + response.status + " — Check your API key." },
        { status: 500 }
      );
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      return Response.json({
        result: data.candidates[0].content.parts[0].text,
      });
    } else {
      return Response.json(
        { error: "No response from Gemini. Try again." },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Route error:", err);
    return Response.json(
      { error: "Server error: " + err.message },
      { status: 500 }
    );
  }
}