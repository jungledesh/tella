// Interface for parsed intent data.
interface ParsedIntent {
  amount: string;
  recipient: string;
  memo: string;
  trigger: string;
}

// Parse SMS body by calling spaCy API.
export async function parseIntent(body: string): Promise<ParsedIntent> {
  const response = await fetch('http://localhost:8080/parse', {
    // Use native fetch.
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text: body }),
  });
  return response.json() as Promise<ParsedIntent>;
}
