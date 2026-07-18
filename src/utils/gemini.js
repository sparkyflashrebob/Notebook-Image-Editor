/**
 * Calls the Gemini API to detect logos, watermarks, stamps, or stickers on a page image.
 * 
 * @param {string} base64Image Base64 data URL (with or without 'data:...;base64,' prefix)
 * @param {string} apiKey Gemini API Key
 * @param {string} model Model name, e.g., 'gemini-2.5-flash'
 * @returns {Promise<Array<{box_2d: number[], label: string}>>} Bounding boxes on 0-1000 scale
 */
export async function detectLogosWithGemini(base64Image, apiKey, model = 'gemini-2.5-flash') {
    if (!apiKey) {
        throw new Error('API key is required.');
    }

    // Strip prefix if any
    let cleanBase64 = base64Image;
    let mimeType = 'image/png';
    if (base64Image.startsWith('data:')) {
        const parts = base64Image.split(',');
        cleanBase64 = parts[1];
        const match = parts[0].match(/data:(.*?);/);
        if (match) {
            mimeType = match[1];
        }
    }

    const prompt = `Identify and detect any logos, watermark text, stamps, signatures, or stickers in this document page. 
For each detected item, return its bounding box as a [ymin, xmin, ymax, xmax] relative coordinate array on a 0 to 1000 normalized scale (where 0 is top/left and 1000 is bottom/right).
Return a valid JSON object matching this schema:
{
  "logos": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "label": "logo"
    }
  ]
}

If no logos or watermarks are present, return an empty array. Do not include any markdown formatting, thoughts, or text outside the JSON.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: cleanBase64
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errText}`);
        }

        const data = await response.json();

        // Parse response JSON from Gemini
        const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResult) {
            return [];
        }

        // Attempt to parse JSON safely
        try {
            const parsedJson = JSON.parse(textResult.trim());
            return parsedJson.logos || [];
        } catch (parseError) {
            console.warn("Retrying regex extraction on malformed JSON response from Gemini:", textResult);
            // Clean up markdown block if model ignored request
            const jsonStart = textResult.indexOf('{');
            const jsonEnd = textResult.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const cleanedText = textResult.substring(jsonStart, jsonEnd + 1);
                const parsedJson = JSON.parse(cleanedText);
                return parsedJson.logos || [];
            }
            throw parseError;
        }
    } catch (error) {
        console.error('Error in detectLogosWithGemini:', error);
        throw error;
    }
}
