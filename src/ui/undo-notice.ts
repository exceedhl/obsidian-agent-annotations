import { Notice } from "obsidian";
import { UNDO_TOAST_MS } from "../constants";

export function showUndoNotice(
	message: string,
	onUndo: () => void,
	timeout = UNDO_TOAST_MS,
): void {
	const wrap = document.createElement("div");
	wrap.className = "aa-undo-notice";
	const text = document.createElement("span");
	text.textContent = message;
	const button = document.createElement("button");
	button.type = "button";
	button.className = "aa-undo-btn";
	button.textContent = "Undo";
	wrap.appendChild(text);
	wrap.appendChild(button);

	const fragment = document.createDocumentFragment();
	fragment.appendChild(wrap);
	const notice = new Notice(fragment, timeout);
	button.addEventListener("click", (event) => {
		event.preventDefault();
		onUndo();
		notice.hide();
	});
}
