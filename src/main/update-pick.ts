/**
 * Which update this app can take, and how: from a GitHub release, the newer version and the file for this platform.
 * Pure functions, so they are tested without Electron or the network.
 */

/** How an update reaches this copy of the app. */
export type UpdateMethod =
    /** electron-updater downloads it, and installs it on restart (Windows, a Linux AppImage, a signed macOS app). */
    | "install"
    /** The app downloads the disk image and opens it; the person drags the app over the old one (macOS, ad hoc signed). */
    | "download"
    /** The app opens the release page; the person installs it the way they installed it (a Linux .deb). */
    | "page"
    /** Run from a checkout (`npm start`): `git pull` updates it. */
    | "source";

export function updateMethod(
    platform: NodeJS.Platform,
    facts: { packaged: boolean; appImage: boolean; teamSigned: boolean },
): UpdateMethod {
    if (!facts.packaged) {
        return "source";
    }

    if (platform === "win32") {
        return "install";
    }

    if (platform === "darwin") {
        // Squirrel.Mac accepts an update only when it and the running app are signed by the same Apple team.
        return facts.teamSigned ? "install" : "download";
    }

    return facts.appImage ? "install" : "page";
}

/** A version as numbers: "v1.2.3" and "1.2.3" alike. Pre-releases ("1.2.3-beta.1") are never offered. */
export function parseVersion(text: string): [number, number, number] | undefined {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());

    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewer(candidate: string, current: string): boolean {
    const a = parseVersion(candidate);
    const b = parseVersion(current);

    if (a === undefined || b === undefined) {
        return false;
    }

    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) {
            return (a[i] ?? 0) > (b[i] ?? 0);
        }
    }

    return false;
}

/** What the GitHub API's latest release says, as far as this app reads it. */
export interface ReleaseAsset {
    name: string;
    url: string;
    size: number;
    /** "sha256:<hex>", where GitHub has one. */
    digest?: string;
}

export interface Release {
    version: string;
    page: string;
    assets: ReleaseAsset[];
}

/** Reads GET /repos/:owner/:repo/releases/latest. Drafts and pre-releases are not offered. */
export function readRelease(value: unknown): Release | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const input = value as Record<string, unknown>;

    if (input.draft === true || input.prerelease === true || typeof input.tag_name !== "string") {
        return undefined;
    }

    const version = input.tag_name.replace(/^v/, "");

    if (parseVersion(version) === undefined || typeof input.html_url !== "string") {
        return undefined;
    }

    const assets: ReleaseAsset[] = [];

    for (const each of Array.isArray(input.assets) ? input.assets : []) {
        const asset = each as Record<string, unknown>;

        if (typeof asset.name === "string" && typeof asset.browser_download_url === "string") {
            assets.push({
                name: asset.name,
                url: asset.browser_download_url,
                size: typeof asset.size === "number" ? asset.size : 0,
                ...(typeof asset.digest === "string" ? { digest: asset.digest } : {}),
            });
        }
    }

    return { version, page: input.html_url, assets };
}

/** The disk image for this Mac: pi-pocket-gui-<version>-mac-<arm64|x64>.dmg. */
export function macImage(release: Release, arch: string): ReleaseAsset | undefined {
    const wanted = arch === "arm64" ? "arm64" : "x64";

    return release.assets.find((asset) => asset.name.endsWith(`-mac-${wanted}.dmg`));
}

/** The hex SHA-256 a GitHub digest names, or undefined. */
export function sha256Of(asset: ReleaseAsset): string | undefined {
    const match = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "");

    return match?.[1]?.toLowerCase();
}

/** A downloaded file's name, kept to safe characters: it comes from the network. */
export function safeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? "";
    const clean = base.replace(/[^\w.-]/g, "_").replace(/^\.+/, "");

    return clean === "" ? "pi-pocket-gui-update.dmg" : clean;
}
