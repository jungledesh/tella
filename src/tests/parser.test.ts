import { parseIntent } from '../parser.ts';

jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockImplementation(({ messages }) => {
            const userMsg = extractSmsIntent(
              (messages as Array<{ role: string; content: string }>).find(
                (m) => m.role === 'user'
              )?.content || ''
            );

            if (userMsg.includes('yes')) {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        amount: 5,
                        recipient: '',
                        memo: '',
                        trigger: 'confirmation',
                      }),
                    },
                  },
                ],
              });
            } else if (userMsg.includes('vcard')) {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        amount: 0,
                        recipient: '[HASHED_PHONE]',
                        memo: '',
                        trigger: 'direct',
                      }),
                    },
                  },
                ],
              });
            } else if (userMsg.includes('pls snd 15')) {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        amount: 15,
                        recipient: '',
                        memo: '',
                        trigger: 'direct',
                      }),
                    },
                  },
                ],
              });
            } else if (userMsg.includes('gimme 20bucks')) {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        amount: 20,
                        recipient: '[HASHED_PHONE]',
                        memo: 'movie',
                        trigger: 'direct',
                      }),
                    },
                  },
                ],
              });
            } else if (userMsg.includes('lunch')) {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        amount: 10,
                        recipient: '[HASHED_PHONE]',
                        memo: 'lunch',
                        trigger: 'direct',
                      }),
                    },
                  },
                ],
              });
            } else {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        amount: 0,
                        recipient: '',
                        memo: '',
                        trigger: '',
                      }),
                    },
                  },
                ],
              });
            }
          }),
        },
      },
    })),
  };
});

describe('Intent Parser', () => {
  const tests = [
    {
      name: 'standard direct transfer',
      input: 'Send $10 to +123-456-0610 for lunch',
      expected: {
        amount: 10,
        recipient: '+11234560610',
        memo: 'lunch',
        trigger: 'direct',
      },
    },
    {
      name: 'confirmation only',
      input: 'Yes $5',
      expected: { amount: 5, recipient: '', memo: '', trigger: 'confirmation' },
    },
    {
      name: 'vCard format',
      input: 'BEGIN:VCARD FN:John Doe TEL;TYPE=CELL:123-456-7890 END:VCARD',
      expected: {
        amount: 0,
        recipient: '+11234567890',
        memo: '',
        trigger: 'direct',
      },
    },
    {
      name: 'no recipient',
      input: 'Send $10 for lunch',
      expected: { amount: 10, recipient: '', memo: 'lunch', trigger: 'direct' },
    },
    {
      name: 'partial command with emoji',
      input: 'pls snd 15 🍔',
      expected: { amount: 15, recipient: '', memo: '', trigger: 'direct' },
    },
    {
      name: 'sloppy formatting',
      input: 'gimme 20bucks to(415)5551234 for movie 🍿',
      expected: {
        amount: 20,
        recipient: '+14155551234',
        memo: 'movie',
        trigger: 'direct',
      },
    },
    {
      name: 'empty input',
      input: '',
      expected: { amount: 0, recipient: '', memo: '', trigger: '' },
    },
    {
      name: 'junk input',
      input: 'asdfghjkl',
      expected: { amount: 0, recipient: '', memo: '', trigger: '' },
    },
  ];

  for (const testCase of tests) {
    test(testCase.name, async () => {
      const parsed = await parseIntent(testCase.input);
      expect(parsed).toMatchObject(testCase.expected);
    });
  }
});

function extractSmsIntent(content: string): string {
  const match = content.match(/SMS:\s*(.*)/i);
  const extracted = match ? match[1] : content;
  return extracted.trim().toLowerCase();
}
