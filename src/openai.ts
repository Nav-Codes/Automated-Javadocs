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

export type ParamDescriptionItem = {
	name: string;
	description: string;
};

export type ThrowsDescriptionItem = {
	type: string;
	description: string;
};

export type MethodDocItem = {
	signature: string;
	description: string;
	params: ParamDescriptionItem[];
	returnDescription: string | null;
	throws: ThrowsDescriptionItem[];
};

export async function getMethodDescriptionsFromAI(
	javaSource: string,
	methodInfos: MethodInfo[],
	apiKey: string,
	model: string
): Promise<Map<string, MethodDocItem>> {
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
								'You analyze Java code and produce concise, accurate Javadoc-ready descriptions for methods and constructors.'
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
					name: 'method_docs',
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
										description: { type: 'string' },
										params: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: false,
												properties: {
													name: { type: 'string' },
													description: { type: 'string' }
												},
												required: ['name', 'description']
											}
										},
										returnDescription: {
											type: ['string', 'null']
										},
										throws: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: false,
												properties: {
													type: { type: 'string' },
													description: { type: 'string' }
												},
												required: ['type', 'description']
											}
										}
									},
									required: [
										'signature',
										'description',
										'params',
										'returnDescription',
										'throws'
									]
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

	return parseMethodDocs(text);
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
Analyze the Java file below and generate Javadoc-ready descriptions.

Return documentation only for these signatures:
${expectedSignatures}

For each signature, return:
- "description": exactly one concise sentence describing what the method or constructor does
- "params": one item for each parameter, with:
  - "name": the exact parameter name
  - "description": exactly one concise sentence fragment or short sentence describing that parameter's purpose
- "returnDescription": exactly one concise sentence fragment or short sentence describing the return value, or null if the method is a constructor or returns void
- "throws": one item for each declared exception, with:
  - "type": the exact declared exception type
  - "description": exactly one concise sentence fragment or short sentence explaining when it is thrown

Rules:
- Use the full Java file for context.
- Be factual and specific.
- Do not include markdown.
- Do not include extra commentary.
- Preserve the exact signature text.
- Include every listed signature exactly once.
- Do not invent extra signatures.
- If a method has no parameters, return an empty params array.
- If a method is a constructor or returns void, return null for returnDescription.
- If a method declares no exceptions, return an empty throws array.
- Parameter names in params must exactly match the source code.
- Exception types in throws must exactly match the declared throws clause.

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

function parseMethodDocs(content: string): Map<string, MethodDocItem> {
	const parsed = JSON.parse(content) as { items: MethodDocItem[] };

	if (!parsed || !Array.isArray(parsed.items)) {
		throw new Error('AI response did not match expected JSON schema.');
	}

	const result = new Map<string, MethodDocItem>();

	for (const item of parsed.items) {
		if (
			!item ||
			typeof item.signature !== 'string' ||
			typeof item.description !== 'string' ||
			!Array.isArray(item.params) ||
			(item.returnDescription !== null &&
				typeof item.returnDescription !== 'string') ||
			!Array.isArray(item.throws)
		) {
			throw new Error(`Invalid item in AI response: ${JSON.stringify(item)}`);
		}

		result.set(item.signature, {
			signature: item.signature,
			description: item.description.trim(),
			params: item.params.map((p) => ({
				name: p.name,
				description: p.description.trim()
			})),
			returnDescription:
				item.returnDescription === null ? null : item.returnDescription.trim(),
			throws: item.throws.map((t) => ({
				type: t.type,
				description: t.description.trim()
			}))
		});
	}

	return result;
}
