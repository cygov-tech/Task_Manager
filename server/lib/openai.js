const DEFAULT_MODEL = "gpt-4.1-mini";

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function getModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function limitWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ");
}

function extractText(data) {
  if (data.output_text) return data.output_text;
  if (!data.output || !Array.isArray(data.output)) return "";

  const chunks = [];
  data.output.forEach((item) => {
    if (!item.content || !Array.isArray(item.content)) return;
    item.content.forEach((contentItem) => {
      if (contentItem.text) chunks.push(contentItem.text);
    });
  });
  return chunks.join("\n");
}

/**
 * Calls the OpenAI Responses API to summarize activity log entries since a given date.
 * Throws if OPENAI_API_KEY is not configured or the request fails.
 */
async function summarizeActivity(logRows, sinceLabel) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Set it in your .env file.");
  }

  const compactLog = logRows
    .slice(-200)
    .map((row) =>
      [row.timestamp, row.action, row.entity, row.entityLabel, row.oldValue, row.newValue, row.details]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n");

  const prompt =
    `Summarize what was accomplished since ${sinceLabel}.\n` +
    "Use only the log entries provided.\n" +
    "Write a structured summary in 100 words or fewer.\n" +
    "Use this format exactly:\n" +
    "Accomplished:\n- ...\n" +
    "Progress:\n- ...\n" +
    "Next focus:\n- ...\n\n" +
    `Log entries:\n${compactLog}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: getModel(),
      input: prompt,
      temperature: 0.2,
      max_output_tokens: 220
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI API request failed with status ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  const text = extractText(data);

  if (!text) {
    throw new Error(`OpenAI response did not include summary text: ${responseText}`);
  }

  return limitWords(text.trim(), 100);
}

module.exports = { isConfigured, getModel, summarizeActivity };
