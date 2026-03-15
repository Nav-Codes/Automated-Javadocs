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

export async function getMethodDescriptionsFromBackend(
	javaSource: string,
	methodInfos: MethodInfo[],
	model: string
): Promise<Map<string, MethodDocItem>> {
	const backendUrl = getBackendUrl();

	const response = await fetch(`${backendUrl}/generate-javadocs`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			javaSource,
			methodInfos,
			model
		})
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Backend request failed: ${response.status} ${errorText}`);
	}

	const parsed = (await response.json()) as { items: MethodDocItem[] };

	if (!parsed || !Array.isArray(parsed.items)) {
		throw new Error('Backend response did not match expected schema.');
	}

	const result = new Map<string, MethodDocItem>();

	for (const item of parsed.items) {
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

function getBackendUrl(): string {
	return 'https://automated-javadocs-backend.onrender.com';
}
