// The admin layout stores PC positions for small icons, so drawn at face value
// our larger tiles overlap. These helpers stretch each axis just enough that no
// two tiles overlap, keeping the room's shape otherwise intact.

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

/** Keeps one stray pair from blowing the whole map up. */
const MAX_SCALE = 6;

/**
 * Smallest x/y scale at which tiles placed at the scaled points don't overlap.
 * Each overlapping pair is resolved along the axis that needs the smaller
 * relative stretch; repeated until stable, since stretching one axis can
 * change which pairs still overlap.
 */
export function fitScale(points: Point[], tile: Tile): { sx: number; sy: number } {
	const spanX = tile.width + tile.gapX;
	const spanY = tile.height + tile.gapY;
	let sx = 1;
	let sy = 1;

	for (let pass = 0; pass < 20; pass++) {
		let needX = sx;
		let needY = sy;

		for (let i = 0; i < points.length; i++) {
			for (let j = i + 1; j < points.length; j++) {
				const dx = Math.abs(points[i].x - points[j].x);
				const dy = Math.abs(points[i].y - points[j].y);
				if (dx === 0 && dy === 0) continue; // Same spot: scaling can't separate them.
				if (dx * sx >= spanX || dy * sy >= spanY) continue;

				const toX = dx > 0 ? spanX / dx : Infinity;
				const toY = dy > 0 ? spanY / dy : Infinity;
				if (toX / sx <= toY / sy) needX = Math.max(needX, toX);
				else needY = Math.max(needY, toY);
			}
		}

		needX = Math.min(needX, MAX_SCALE);
		needY = Math.min(needY, MAX_SCALE);
		if (needX === sx && needY === sy) break;
		sx = needX;
		sy = needY;
	}

	return { sx, sy };
}
