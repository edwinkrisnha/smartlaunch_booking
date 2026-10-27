// The admin layout stores PC positions for small icons, so drawn at face value
// our larger tiles overlap. `placeSeats` stretches the room just enough for its
// typical desk spacing, then moves any tile that still overlaps to the nearest
// free spot, so one misplaced PC can't blow the whole map up.

export interface Point {
	x: number;
	y: number;
}

export interface Tile {
	width: number;
	height: number;
	/** Space between tiles side by side; desks in a row can sit close. */
	gapX: number;
	/** Space between rows. */
	gapY: number;
}

/** Stretches more than this far above the typical one are treated as outliers. */
const OUTLIER_FACTOR = 1.25;
/** Step and range of the search for a free spot, in pixels. */
const SEARCH_STEP = 4;
const SEARCH_RADIUS = 600;

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Scale per axis that separates the room's typical neighbours. Each overlapping
 * pair asks for a stretch along its cheaper axis; we take the largest request
 * that is close to the typical one, ignoring outliers such as two PCs placed
 * almost on top of each other.
 */
export function typicalScale(points: Point[], tile: Tile): { sx: number; sy: number } {
	const spanX = tile.width + tile.gapX;
	const spanY = tile.height + tile.gapY;
	const needX: number[] = [];
	const needY: number[] = [];

	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			const dx = Math.abs(points[i].x - points[j].x);
			const dy = Math.abs(points[i].y - points[j].y);
			if (dx >= spanX || dy >= spanY) continue;
			if (dx === 0 && dy === 0) continue;

			const toX = dx > 0 ? spanX / dx : Infinity;
			const toY = dy > 0 ? spanY / dy : Infinity;
			if (toX <= toY) needX.push(toX);
			else needY.push(toY);
		}
	}

	const pick = (needs: number[]) => {
		if (needs.length === 0) return 1;
		const limit = median(needs) * OUTLIER_FACTOR;
		return Math.max(1, ...needs.filter((n) => n <= limit));
	};
	return { sx: pick(needX), sy: pick(needY) };
}

function overlaps(a: Point, b: Point, tile: Tile): boolean {
	return Math.abs(a.x - b.x) < tile.width + tile.gapX && Math.abs(a.y - b.y) < tile.height + tile.gapY;
}

/** Nearest offset from `p` (searching outward) where a tile fits among `placed`. */
function nearestFree(p: Point, placed: Point[], tile: Tile): Point {
	const fits = (c: Point) => placed.every((q) => !overlaps(c, q, tile));
	for (let r = SEARCH_STEP; r <= SEARCH_RADIUS; r += SEARCH_STEP) {
		for (const c of [
			{ x: p.x + r, y: p.y },
			{ x: p.x - r, y: p.y },
			{ x: p.x, y: p.y + r },
			{ x: p.x, y: p.y - r }
		]) {
			if (fits(c)) return c;
		}
	}
	return p; // Nowhere nearby; leave it overlapping rather than flinging it away.
}

/**
 * Screen positions (before padding/offset) for each point, in the same order:
 * scaled by the room's typical spacing, with leftover collisions resolved by
 * moving individual tiles.
 */
export function placeSeats(points: Point[], tile: Tile): Point[] {
	const { sx, sy } = typicalScale(points, tile);
	const scaled = points.map((p) => ({ x: p.x * sx, y: p.y * sy }));

	// Place well-behaved tiles first so the misplaced ones are the ones that move.
	const collisions = scaled.map((p, i) => scaled.filter((q, j) => i !== j && overlaps(p, q, tile)).length);
	const order = scaled.map((_, i) => i).sort((a, b) => collisions[a] - collisions[b]);

	const result: Point[] = new Array(points.length);
	const placed: Point[] = [];
	for (const i of order) {
		const p = scaled[i];
		const spot = placed.some((q) => overlaps(p, q, tile)) ? nearestFree(p, placed, tile) : p;
		result[i] = spot;
		placed.push(spot);
	}
	return result;
}
