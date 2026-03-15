export type ParamInfo = {
	type: string;
	name: string;
};

export type MethodInfo = {
	name: string;
	isConstructor: boolean;
	returnType?: string;
	params: ParamInfo[];
	throws: string[];
	indent: string;
	insertLine: number;
};

type MethodDescriptionItem = {
	signature: string;
	description: string;
};

export async function getMethodDescriptionsFromAI(
	javaSource: string,
	methodInfos: MethodInfo[],
	apiKey: string,
	model: string
): Promise<Map<string, string>> {
	const prompt = buildMethodDescriptionPrompt(javaSource, methodInfos);

	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model,
			input: [
				{
					role: 'system',
					content: [
						{
							type: 'input_text',
							text:
								'You analyze Java code and produce concise, accurate one-sentence method and constructor descriptions.'
						}
					]
				},
				{
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: prompt
						}
					]
				}
			],
			text: {
				format: {
					type: 'json_schema',
					name: 'method_descriptions',
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							items: {
								type: 'array',
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										signature: { type: 'string' },
										description: { type: 'string' }
									},
									required: ['signature', 'description']
								}
							}
						},
						required: ['items']
					},
					strict: true
				}
			}
		})
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
	}

	const data = await response.json();
	const text = extractOutputText(data);

	if (!text) {
		throw new Error('OpenAI API returned no output text.');
	}

	return parseMethodDescriptions(text);
}

export function buildSignature(info: MethodInfo): string {
	const paramTypes = info.params
		.map((p) => normalizeSignatureType(p.type))
		.join(',');
	return `${info.name}(${paramTypes})`;
}

function normalizeSignatureType(type: string): string {
	return type
		.replace(/\bfinal\s+/g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s*,\s*/g, ',')
		.trim();
}

function buildMethodDescriptionPrompt(
	javaSource: string,
	methodInfos: MethodInfo[]
): string {
	const expectedSignatures = methodInfos.map(buildSignature).join('\n');

	return `
Analyze the Java file below.

Write exactly one concise sentence for each method and constructor.
Use the full file for context.
Be factual and specific.
Do not include markdown.
Do not include any text outside the required JSON structure.

Return descriptions only for these signatures:
${expectedSignatures}

Rules:
- Keep each description to one sentence.
- End each description with a period.
- Preserve the exact signature text.
- Include every listed signature exactly once.
- Do not invent extra signatures.

Java file:
\`\`\`java
${javaSource}
\`\`\`
`.trim();
}

function extractOutputText(data: any): string {
	if (typeof data?.output_text === 'string' && data.output_text.trim()) {
		return data.output_text.trim();
	}

	const output = data?.output;
	if (Array.isArray(output)) {
		const texts: string[] = [];

		for (const item of output) {
			if (!Array.isArray(item?.content)) {
				continue;
			}

			for (const contentItem of item.content) {
				if (typeof contentItem?.text === 'string') {
					texts.push(contentItem.text);
				}
			}
		}

		return texts.join('\n').trim();
	}

	return '';
}

function parseMethodDescriptions(content: string): Map<string, string> {
	const parsed = JSON.parse(content) as { items: MethodDescriptionItem[] };

	if (!parsed || !Array.isArray(parsed.items)) {
		throw new Error('AI response did not match expected JSON schema.');
	}

	const result = new Map<string, string>();

	for (const item of parsed.items) {
		if (
			!item ||
			typeof item.signature !== 'string' ||
			typeof item.description !== 'string'
		) {
			throw new Error(`Invalid item in AI response: ${JSON.stringify(item)}`);
		}

		result.set(item.signature, item.description.trim());
	}

	return result;
}
