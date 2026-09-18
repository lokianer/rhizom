// Obsidian-style wikilinks for remark: `[[target#heading|alias]]` and `![[target]]` (embed).
// The micromark construct runs before the core link/image constructs (extensions are tried
// first), so `![[` is not read as an image and `[[` not as a label start. A wikilink must be
// closed on the same line; otherwise the text is left as it was written.
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token,
} from 'mdast-util-from-markdown';
import type { Literal } from 'mdast';
import { codes } from 'micromark-util-symbol';
import type {
  Code,
  Construct,
  Effects,
  Extension as MicromarkExtension,
  State,
  TokenizeContext,
} from 'micromark-util-types';
import type { Processor } from 'unified';

export interface Wikilink extends Literal {
  type: 'wikilink';
  /** The text between the brackets, untrimmed. */
  value: string;
  embed: boolean;
}

declare module 'mdast' {
  interface PhrasingContentMap {
    wikilink: Wikilink;
  }
  interface RootContentMap {
    wikilink: Wikilink;
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikilink: 'wikilink';
    wikilinkEmbedMarker: 'wikilinkEmbedMarker';
    wikilinkMarker: 'wikilinkMarker';
    wikilinkContent: 'wikilinkContent';
  }
}

function isLineEnding(code: Code): boolean {
  return (
    code === codes.eof ||
    code === codes.carriageReturn ||
    code === codes.lineFeed ||
    code === codes.carriageReturnLineFeed
  );
}

function tokenizer(embed: boolean) {
  return function tokenizeWikilink(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    return embed ? embedMarker : firstBracket;

    function embedMarker(code: Code): State | undefined {
      effects.enter('wikilink');
      effects.enter('wikilinkEmbedMarker');
      effects.consume(code);
      effects.exit('wikilinkEmbedMarker');
      return firstBracketAfterEmbed;
    }

    function firstBracketAfterEmbed(code: Code): State | undefined {
      if (code !== codes.leftSquareBracket) {
        return nok(code);
      }
      effects.enter('wikilinkMarker');
      effects.consume(code);
      return secondBracket;
    }

    function firstBracket(code: Code): State | undefined {
      effects.enter('wikilink');
      effects.enter('wikilinkMarker');
      effects.consume(code);
      return secondBracket;
    }

    function secondBracket(code: Code): State | undefined {
      if (code !== codes.leftSquareBracket) {
        return nok(code);
      }
      effects.consume(code);
      effects.exit('wikilinkMarker');
      return contentStart;
    }

    function contentStart(code: Code): State | undefined {
      if (code === codes.rightSquareBracket || isLineEnding(code)) {
        return nok(code);
      }
      effects.enter('wikilinkContent');
      return content(code);
    }

    function content(code: Code): State | undefined {
      if (isLineEnding(code)) {
        return nok(code);
      }
      if (code === codes.rightSquareBracket) {
        effects.exit('wikilinkContent');
        effects.enter('wikilinkMarker');
        effects.consume(code);
        return closingSecondBracket;
      }
      effects.consume(code);
      return content;
    }

    function closingSecondBracket(code: Code): State | undefined {
      if (code !== codes.rightSquareBracket) {
        return nok(code);
      }
      effects.consume(code);
      effects.exit('wikilinkMarker');
      effects.exit('wikilink');
      return ok;
    }
  };
}

const wikilinkConstruct: Construct = { name: 'wikilink', tokenize: tokenizer(false) };
const embedConstruct: Construct = { name: 'wikilinkEmbed', tokenize: tokenizer(true) };

export function wikilinkSyntax(): MicromarkExtension {
  return {
    text: {
      [codes.leftSquareBracket]: wikilinkConstruct,
      [codes.exclamationMark]: embedConstruct,
    },
  };
}

export function wikilinkFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      wikilink(this: CompileContext, token: Token) {
        this.enter({ type: 'wikilink', value: '', embed: false }, token);
      },
      wikilinkEmbedMarker(this: CompileContext) {
        const node = this.stack[this.stack.length - 1];
        if (node?.type === 'wikilink') {
          node.embed = true;
        }
      },
    },
    exit: {
      wikilinkContent(this: CompileContext, token: Token) {
        const node = this.stack[this.stack.length - 1];
        if (node?.type === 'wikilink') {
          node.value = this.sliceSerialize(token);
        }
      },
      wikilink(this: CompileContext, token: Token) {
        this.exit(token);
      },
    },
  };
}

/** remark plugin: adds `wikilink` nodes to the mdast tree. */
export function remarkWikilink(this: Processor): void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(wikilinkSyntax());
  (data.fromMarkdownExtensions ??= []).push(wikilinkFromMarkdown());
}
