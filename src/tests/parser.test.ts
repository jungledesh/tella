// Mock OpenAI API for intent parsing.
import { parseIntent } from '../parser.ts';

jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
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
          }),
        },
      },
    })),
  };
});

describe('Intent Parser', () => {
  test('parseIntent handles direct SMS', async () => {
    const parsed = await parseIntent('Send $10 to +123-456-0610 for lunch');
    expect(parsed).toEqual({
      amount: 10,
      recipient: '123-456-0610',
      memo: 'lunch',
      trigger: 'direct',
    });
  });
});
