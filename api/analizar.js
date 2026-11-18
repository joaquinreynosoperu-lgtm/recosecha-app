// Función serverless de Vercel: recibe una foto (base64) y devuelve el análisis en JSON.
// Usa la API de Gemini (Google AI Studio). La clave vive solo aquí, en el servidor.

const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const PROMPT = `Eres un asistente de inspección de frutas y verduras para comerciantes de un mercado mayorista en Lima, Perú.
Analiza la foto y responde SOLO con un objeto JSON válido, sin texto adicional, con esta forma exacta:
{
  "es_alimento": true o false,
  "producto": "nombre del producto en español (ej. Mandarina, Papaya, Tomate)",
  "estado_visible": "descripción breve de lo que se ve (manchas, golpes, moho, firmeza aparente, madurez)",
  "dias_utiles": número entero de 0 a 4,
  "destino": "venta" | "donacion" | "compost",
  "confianza": "alta" | "media" | "baja",
  "motivo": "explicación de 1 o 2 frases para el comerciante",
  "precaucion": "una recomendación corta de verificación física antes de decidir"
}
Criterios:
- "venta": producto en buen estado, con 2 o más días útiles.
- "donacion": producto aún comestible y sin moho ni fermentación, pero que ya no conviene vender (muy maduro, golpes leves, 1 día útil).
- "compost": moho, podredumbre, fermentación, mal olor aparente o daño avanzado (0 días útiles).
- Si ves moho o podredumbre, NUNCA elijas donación.
- Si la foto no muestra un alimento, está borrosa u oscura, pon es_alimento false o confianza "baja" y explica qué foto necesitas.
- Una foto no muestra el interior del producto: sé prudente y refleja esa incertidumbre en la confianza.`;

function extraerJSON(texto) {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio === -1 || fin === -1) throw new Error("La IA no devolvió un JSON");
  return JSON.parse(texto.slice(inicio, fin + 1));
}

function mensajeDeError(datos) {
  const d = Array.isArray(datos) ? datos[0] : datos;
  const e = d && d.error;
  if (!e) return "Error del servicio de IA";
  return typeof e === "string" ? e : e.message || JSON.stringify(e);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Usa POST" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Falta la variable GEMINI_API_KEY en Vercel" });
  }
  const modelo = process.env.MODEL || "gemini-2.5-flash";

  try {
    const { imagen } = req.body || {};
    if (!imagen || !imagen.startsWith("data:image/")) {
      return res.status(400).json({ error: "Falta la imagen" });
    }

    const cuerpo = {
      model: modelo,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: imagen } },
          ],
        },
      ],
    };
    // Pedimos poco "razonamiento" para que responda rápido. Con REASONING=off no se envía.
    if (process.env.REASONING !== "off") {
      cuerpo.reasoning_effort = process.env.REASONING || "low";
    }

    const respuesta = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(26000), // corta antes del límite de 30 s de Vercel
    });

    const datos = await respuesta.json();
    if (!respuesta.ok) {
      return res.status(502).json({ error: `IA (${respuesta.status}): ${mensajeDeError(datos)}`, modelo });
    }

    const texto = datos.choices && datos.choices[0] && datos.choices[0].message && datos.choices[0].message.content;
    const resultado = extraerJSON(String(texto || ""));
    return res.status(200).json({ resultado, modelo });
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return res.status(504).json({ error: "La IA tardó demasiado en responder. Intenta de nuevo." });
    }
    return res.status(500).json({ error: e.message || "Error inesperado" });
  }
};
