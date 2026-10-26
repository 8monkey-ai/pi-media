import { mediaModels, type Settings } from "./config.ts";

export function footerStatus(settings: Settings) {
	const models = mediaModels(settings).map(({ kind, provider, id }) => `${kind} ${provider}/${id}`);
	return models.length > 0 ? `media: ${models.join(", ")}` : undefined;
}

export function unknownProviderErrors(path: string, settings: Settings, hasProvider: (provider: string) => boolean) {
	return mediaModels(settings)
		.filter(({ provider }) => !hasProvider(provider))
		.map(
			({ setting, provider }) =>
				`pi-media: ${setting} in ${path}: pi has no provider "${provider}". Add it in models.json or with an extension. pi-media is off for this session.`,
		);
}
