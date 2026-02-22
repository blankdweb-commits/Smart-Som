export const generateFlashcardWithAI = async (apiKey, topic, subject) => {
  if (!apiKey) throw new Error('DeepSeek API Key is required');

  const prompt = `You are a professional Nursing and Midwifery educator.
  Generate a high-yield flashcard for the following topic and subject.
  Subject: ${subject}
  Topic: ${topic}

  Format your response as a JSON object with "question" and "answer" fields.
  The question should be concise and test critical nursing knowledge.
  The answer should be accurate and educational.`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that generates nursing flashcards in JSON format.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        stream: false
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to generate question');
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    return content;
  } catch (error) {
    console.error('AI Generation Error:', error);
    throw error;
  }
};
