import { Notice } from "obsidian";
import { UNDO_TOAST_MS } from "../constants";

export function showUndoNotice(
	message: string,
	onUndo: () => void,
	timeout = UNDO_TOAST_MS,
): void {
	const wrap = createDiv({ cls: "aa-undo-notice" });
	wrap.createSpan({ text: message });
	const button = wrap.createEl("button", {
		cls: "aa-undo-btn",
		text: "Undo",
		attr: { type: "button" },
	});

	const fragment = createFragment((node) => {
		node.appendChild(wrap);
	});
	const notice = new Notice(fragment, timeout);
	button.addEventListener("click", (event) => {
		event.preventDefault();
		onUndo();
		notice.hide();
	});
}
