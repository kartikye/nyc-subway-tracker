import { readFile, writeFile } from "node:fs/promises";

/**
 * Load a remote JSON file, using an already downloaded cached version
 * if it exists.
 * 
 * @param {string} url 
 * @returns the JSON parse
 */
async function loadCachedOrDownload(url) {
    const pathParts = new URL(url).pathname.split("/");
    const cachedFilePath = pathParts[pathParts.length-1];
    try {
        return JSON.parse(await readFile(cachedFilePath));
    } catch (err) {
        if (err?.errno === -2) {
            const contents = (await fetch(url)).arrayBuffer();
            try {
                await writeFile(contents, cachedFilePath);
            } catch (err) {
                console.warn(err);
            }
            return JSON.parse(contents);
        }
        throw err;
    }
}

/**
 * Convert the raw MTA open data to the format expected by stations.js
 * 
 * @param {object} rawData 
 */
function convertRawStations(rawData) {
    return {
        id: rawData.gtfs_stop_id,
        name: rawData.stop_name,
        lines: rawData.daytime_routes,
        borough: rawData.borough,
        lat: rawData.gtfs_latitude,
        lon: rawData.gtfs_longitude,
        complexId: rawData.complex_id,
    }
}

const rawDataArr = await loadCachedOrDownload("https://data.ny.gov/resource/39hk-dx4f.json");
await writeFile("stations.js", "const STATIONS = " + JSON.stringify(rawDataArr.map(convertRawStations)) + `;
const STATIONS_BY_ID = Object.fromEntries(STATIONS.map(s => [s.id, s]));
if (typeof module !== 'undefined' && module.exports) { module.exports = { STATIONS, STATIONS_BY_ID }; };
`);

console.log("Wrote stations.js");
