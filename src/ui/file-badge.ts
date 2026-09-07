import type { MarkdownView } from "obsidian";
import { BADGE_CLASS } from "../constants";

export function updateFileBadge(view: MarkdownView, count: number): void {
	const title = view.containerEl.querySelector(".view-header-title-container");
	if (!title) return;

	let badge = title.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
	if (count <= 0) {
		badge?.remove();
		return;
	}

	if (!badge) {
		badge = document.createElement("span");
		badge.className = BADGE_CLASS;
		title.appendChild(badge);
	}
	badge.textContent = `Agent annotations · ${count}`;
}

export function clearFileBadge(view: MarkdownView): void {
	view.containerEl.querySelector(`.${BADGE_CLASS}`)?.remove();
}
