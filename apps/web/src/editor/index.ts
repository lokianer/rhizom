export { type BlockLinkRefusal, type BlockLinkResult } from './block-link.js';
export { MarkdownEditor, type MarkdownEditorProps } from './MarkdownEditor.js';
export { COMMANDS as SLASH_COMMANDS, type CommandId } from './slash.js';

// `templateNotes` is deliberately not re-exported here. This barrel reaches MarkdownEditor,
// whose `import './editor.css'` is a side effect no bundler may drop, so anything importing from
// it carries the whole of CodeMirror; the app frame wants the rule and not the editor, and takes
// it from `./template-model.js` directly.
