const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Information Extractor Node Executor
 * Uses AI to extract structured data from text
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const attributes = params.attributes?.attributes || [];

  if (attributes.length === 0) {
    throw new Error('No attributes defined for extraction');
  }

  const results = [];

  console.log(`[InformationExtractor] Processing ${inputData?.length || 0} items with ${attributes.length} attributes`);

  for (const item of inputData || []) {
    try {
      // Get text to extract from
      let text = params.text;
      if (text) {
        text = evaluateExpression(text, {
          currentInput: [item],
          executionContext
        });
      } else {
        text = item.json?.text || item.json?.content || JSON.stringify(item.json);
      }

      if (!text) {
        throw new Error('No text provided for extraction');
      }

      // Build extraction prompt
      const extractionSchema = attributes.map(attr => {
        return `- ${attr.name}: ${attr.description}${attr.required ? ' (required)' : ''}`;
      }).join('\n');

      const prompt = `Extract the following information from the text below. Return ONLY a valid JSON object with the exact field names specified.

Fields to extract:
${extractionSchema}

Text to analyze:
${text}

Return the data as a JSON object with these exact keys: ${attributes.map(a => a.name).join(', ')}`;

      // Use Groq API for extraction
      const apiKey = executionContext.tokens?.groqApiKey ||
        executionContext.tokenInjector?.getToken('groqApiKey') ||
        process.env.GROQ_API_KEY;

      if (!apiKey) {
        throw new Error('GROQ_API_KEY not provided');
      }

      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a data extraction assistant. Extract information exactly as requested and return valid JSON only. Do not include any explanations or markdown formatting.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0]?.message?.content || '{}';

      // Parse the JSON response
      let extractedData;
      try {
        extractedData = JSON.parse(content);
      } catch (parseError) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[1]);
        } else {
          throw new Error(`Failed to parse extracted data: ${parseError.message}`);
        }
      }

      results.push({
        json: {
          ...item.json,
          ...extractedData
        }
      });

    } catch (error) {
      if (error.response) {
        throw new Error(`AI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Information extraction error: ${error.message}`);
    }
  }

  return results;
}

module.exports = {
  execute
};
