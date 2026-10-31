/**
 * Which Node.js and which Pi Pocket this computer's Pi Pocket runs on, and where their files go. Pure: the downloads
 * and processes are in src/main/local-server.ts.
 */
import { join } from "node:path";

/** One release in nodejs.org/dist/index.json. */
export interface NodeRelease {
    version: string;
    lts: string | false;
    files: string[];
}

/** The Node.js archive for this computer. */
export interface NodeDownload {
    /** Without the v: "26.13.0". */
    version: string;
    /** The file name on nodejs.org, also its name in SHASUMS256.txt. */
    file: string;
    url: string;
    /** The folder the archive holds everything in. */
    folder: string;
}

const DIST = "https://nodejs.org/dist";

type Version = [number, number, number];

export function parseVersion(text: string): Version | undefined {
    const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text.trim());

    if (match === null) {
        return undefined;
    }

    return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number {
    const left = parseVersion(a) ?? [0, 0, 0];
    const right = parseVersion(b) ?? [0, 0, 0];

    for (let i = 0; i < 3; i++) {
        const difference = left[i]! - right[i]!;

        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
}

/**
 * Whether a version meets an `engines.node` range. Enough of npm's syntax for what packages write there: `||`,
 * comparators (>=, >, <=, <, =), ^ and ~, x ranges, and a bare version. A range it cannot read allows nothing.
 */
export function satisfies(version: string, range: string): boolean {
    const target = parseVersion(version);

    if (target === undefined) {
        return false;
    }

    return range.split("||").some((alternative) => {
        const parts = alternative.trim().split(/\s+/).filter((part) => part !== "");

        if (parts.length === 0 || (parts.length === 1 && (parts[0] === "*" || parts[0] === "x"))) {
            return true;
        }

        return parts.every((part) => meets(version, part));
    });
}

function meets(version: string, comparator: string): boolean {
    const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(comparator);

    if (match === null) {
        return false;
    }

    const operator = match[1] ?? "";
    const pieces = [match[2], match[3], match[4]];
    const given = pieces.findIndex((piece) => piece === undefined || piece === "x" || piece === "*");
    const exact = given === -1 ? 3 : given;
    const base = pieces.map((piece) => (piece === undefined || piece === "x" || piece === "*" ? "0" : piece)).join(".");
    const cmp = compareVersions(version, base);
    const [major, minor] = parseVersion(base)!;

    /** The first version past the range a partial or caret/tilde version names. */
    const upper = (level: number): string =>
        level === 0 ? `${major + 1}.0.0` : level === 1 ? `${major}.${minor + 1}.0` : base;

    switch (operator) {
        case ">=":
            return cmp >= 0;
        case ">":
            return exact === 3 ? cmp > 0 : compareVersions(version, upper(exact - 1)) >= 0;
        case "<=":
            return exact === 3 ? cmp <= 0 : compareVersions(version, upper(exact - 1)) < 0;
        case "<":
            return cmp < 0;
        case "^": {
            const level = major > 0 || exact < 2 ? 0 : 1;

            return cmp >= 0 && compareVersions(version, upper(level)) < 0;
        }
        case "~":
            return cmp >= 0 && compareVersions(version, upper(exact >= 2 ? 1 : 0)) < 0;
        default:
            return exact === 3 ? cmp === 0 : cmp >= 0 && compareVersions(version, upper(exact - 1)) < 0;
    }
}

/** nodejs.org's names for this computer, and the archive kind each has. */
function nodePlatform(platform: NodeJS.Platform, arch: string): { index: string; name: string; ext: string } | undefined {
    if (arch !== "x64" && arch !== "arm64") {
        return undefined;
    }

    switch (platform) {
        case "darwin":
            // macOS's tar reads xz itself; the file is half the size of the gzip one.
            return { index: `osx-${arch}-tar`, name: `darwin-${arch}`, ext: "tar.xz" };
        case "linux":
            // gzip: not every Linux has xz.
            return { index: `linux-${arch}`, name: `linux-${arch}`, ext: "tar.gz" };
        case "win32":
            return { index: `win-${arch}-zip`, name: `win-${arch}`, ext: "zip" };
        default:
            return undefined;
    }
}

/** The newest LTS release that the range allows and that has an archive for this computer. */
export function pickNode(
    releases: NodeRelease[],
    engines: string,
    platform: NodeJS.Platform,
    arch: string,
): NodeDownload | undefined {
    const names = nodePlatform(platform, arch);

    if (names === undefined) {
        return undefined;
    }

    const fitting = releases
        .filter((release) => release.lts !== false && release.files.includes(names.index) && satisfies(release.version, engines))
        .sort((a, b) => compareVersions(b.version, a.version));
    const release = fitting[0];

    if (release === undefined) {
        return undefined;
    }

    const version = release.version.replace(/^v/, "");
    const folder = `node-v${version}-${names.name}`;
    const file = `${folder}.${names.ext}`;

    return { version, file, url: `${DIST}/v${version}/${file}`, folder };
}

export function shasumsUrl(version: string): string {
    return `${DIST}/v${version}/SHASUMS256.txt`;
}

/** The SHA-256 of one file in a SHASUMS256.txt. */
export function shasumFor(text: string, file: string): string | undefined {
    for (const line of text.split("\n")) {
        const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());

        if (match !== null && match[2] === file) {
            return match[1];
        }
    }

    return undefined;
}

/** Where things are in one runtime: a Node.js, with Pi Pocket installed globally in it. */
export function runtimePaths(folder: string, platform: NodeJS.Platform) {
    const windows = platform === "win32";
    const modules = windows ? join(folder, "node_modules") : join(folder, "lib", "node_modules");

    return {
        folder,
        node: windows ? join(folder, "node.exe") : join(folder, "bin", "node"),
        /** The folder that holds node and npm: put on PATH, after the person's own. */
        bin: windows ? folder : join(folder, "bin"),
        npm: join(modules, "npm", "bin", "npm-cli.js"),
        pocket: join(modules, "pi-pocket"),
        launcher: join(modules, "pi-pocket", "bin", "pi-pocket.js"),
    };
}

/** The address and login link in the panel Pi Pocket's launcher prints once the server is ready. */
export function signInLine(line: string): { url: string; origin: string; loginPath: string } | undefined {
    // eslint-disable-next-line no-control-regex
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    const match = /^\s*Sign in\s+(https?:\/\/\S+)\s*$/.exec(plain);

    if (match === null) {
        return undefined;
    }

    try {
        const url = new URL(match[1]!);

        if (url.pathname !== "/login" || !url.searchParams.has("token")) {
            return undefined;
        }

        return { url: url.href, origin: url.origin, loginPath: `${url.pathname}${url.search}` };
    } catch {
        return undefined;
    }
}

/** A line of the launcher's output, safe to show and keep: no login token, no colors. */
export function cleanLine(line: string): string {
    // eslint-disable-next-line no-control-regex
    return line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/([?&]token=)[^\s&]+/g, "$1…").trimEnd();
}
