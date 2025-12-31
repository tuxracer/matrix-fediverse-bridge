/**
 * Unit tests for message transformer
 */

// Helper functions extracted for testing
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function transformMatrixMentionsToAP(content: string, _domain: string): string {
  return content.replace(
    /@([a-zA-Z0-9._=-]+):([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    '@$1@$2'
  );
}

function transformAPMentionsToMatrix(content: string, bridgeDomain: string): string {
  return content.replace(
    /@([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (match, user: string, server: string) => {
      if (server === bridgeDomain) {
        return `@${user}:${server}`;
      }
      return `@_ap_${user}_${server.replace(/\./g, '_')}:${bridgeDomain}`;
    }
  );
}

function sanitizeHtmlForMatrix(html: string): string {
  let result = html;
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  result = result.replace(/\bon\w+\s*=\s*"[^"]*"/gi, '');
  result = result.replace(/\bon\w+\s*=\s*'[^']*'/gi, '');
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  result = result.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  result = result.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
  return result;
}

describe('HTML Processing', () => {
  describe('stripHtml', () => {
    it('should remove all HTML tags', () => {
      expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    it('should convert br tags to newlines', () => {
      expect(stripHtml('Hello<br>world')).toBe('Hello\nworld');
      expect(stripHtml('Hello<br/>world')).toBe('Hello\nworld');
      expect(stripHtml('Hello<br />world')).toBe('Hello\nworld');
    });

    it('should convert p closing tags to double newlines', () => {
      expect(stripHtml('<p>First</p><p>Second</p>')).toBe('First\n\nSecond');
    });

    it('should decode HTML entities', () => {
      expect(stripHtml('&lt;script&gt;')).toBe('<script>');
      expect(stripHtml('&amp;&quot;&#39;')).toBe('&"\'');
      expect(stripHtml('hello&nbsp;world')).toBe('hello world');
    });

    it('should handle nested tags', () => {
      expect(stripHtml('<div><p><strong>Bold</strong> and <em>italic</em></p></div>')).toBe('Bold and italic');
    });

    it('should trim whitespace', () => {
      expect(stripHtml('  <p>Hello</p>  ')).toBe('Hello');
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape angle brackets', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape quotes', () => {
      expect(escapeHtml('He said "hello"')).toBe('He said &quot;hello&quot;');
      expect(escapeHtml("It's fine")).toBe('It&#39;s fine');
    });

    it('should handle multiple special characters', () => {
      expect(escapeHtml('<a href="test">&</a>')).toBe('&lt;a href=&quot;test&quot;&gt;&amp;&lt;/a&gt;');
    });
  });

  describe('sanitizeHtmlForMatrix', () => {
    it('should remove script tags', () => {
      expect(sanitizeHtmlForMatrix('<p>Hello</p><script>alert("xss")</script>')).toBe('<p>Hello</p>');
    });

    it('should remove event handlers with double quotes', () => {
      expect(sanitizeHtmlForMatrix('<img src="x" onerror="alert(1)">')).toBe('<img src="x" >');
    });

    it('should remove event handlers with single quotes', () => {
      expect(sanitizeHtmlForMatrix("<img src='x' onclick='alert(1)'>")).toBe("<img src='x' >");
    });

    it('should remove style tags', () => {
      expect(sanitizeHtmlForMatrix('<style>.evil { display: none; }</style><p>Hello</p>')).toBe('<p>Hello</p>');
    });

    it('should neutralize javascript: URLs', () => {
      expect(sanitizeHtmlForMatrix('<a href="javascript:alert(1)">Click</a>')).toBe('<a href="#">Click</a>');
    });

    it('should preserve safe HTML', () => {
      const safeHtml = '<p>Hello <strong>world</strong></p>';
      expect(sanitizeHtmlForMatrix(safeHtml)).toBe(safeHtml);
    });
  });
});

describe('Mention Transformation', () => {
  describe('transformMatrixMentionsToAP', () => {
    it('should convert Matrix mentions to AP format', () => {
      expect(transformMatrixMentionsToAP('Hello @user:example.com!', 'bridge.example.com'))
        .toBe('Hello @user@example.com!');
    });

    it('should handle multiple mentions', () => {
      expect(transformMatrixMentionsToAP('Hey @alice:server.org and @bob:other.net', 'bridge.example.com'))
        .toBe('Hey @alice@server.org and @bob@other.net');
    });

    it('should handle mentions with special characters in localpart', () => {
      expect(transformMatrixMentionsToAP('@user.name-123:example.com', 'bridge.example.com'))
        .toBe('@user.name-123@example.com');
    });

    it('should not modify non-mention text', () => {
      expect(transformMatrixMentionsToAP('Hello world', 'bridge.example.com'))
        .toBe('Hello world');
    });

    it('should not modify email addresses', () => {
      // Email format is different from Matrix IDs (no @ prefix)
      expect(transformMatrixMentionsToAP('Contact: user@example.com', 'bridge.example.com'))
        .toBe('Contact: user@example.com');
    });
  });

  describe('transformAPMentionsToMatrix', () => {
    const bridgeDomain = 'bridge.example.com';

    it('should convert local AP mentions to Matrix format', () => {
      expect(transformAPMentionsToMatrix('Hello @user@bridge.example.com!', bridgeDomain))
        .toBe('Hello @user:bridge.example.com!');
    });

    it('should convert remote AP mentions to ghost user format', () => {
      expect(transformAPMentionsToMatrix('Hello @alice@mastodon.social!', bridgeDomain))
        .toBe('Hello @_ap_alice_mastodon_social:bridge.example.com!');
    });

    it('should handle multiple mentions from different servers', () => {
      const input = 'Hey @alice@mastodon.social and @bob@bridge.example.com';
      const expected = 'Hey @_ap_alice_mastodon_social:bridge.example.com and @bob:bridge.example.com';
      expect(transformAPMentionsToMatrix(input, bridgeDomain)).toBe(expected);
    });

    it('should handle domains with multiple dots', () => {
      expect(transformAPMentionsToMatrix('@user@sub.domain.example.com', bridgeDomain))
        .toBe('@_ap_user_sub_domain_example_com:bridge.example.com');
    });
  });
});

describe('Content Transformation Edge Cases', () => {
  it('should handle empty content', () => {
    expect(stripHtml('')).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  it('should handle content with only tags', () => {
    expect(stripHtml('<div><span></span></div>')).toBe('');
  });

  it('should handle malformed HTML gracefully', () => {
    expect(stripHtml('<p>Unclosed paragraph')).toBe('Unclosed paragraph');
    expect(stripHtml('Text with < and > symbols')).toBe('Text with  symbols');
  });

  it('should handle deeply nested HTML', () => {
    const nested = '<div><div><div><div><p>Deep</p></div></div></div></div>';
    expect(stripHtml(nested)).toBe('Deep');
  });

  it('should preserve text between tags', () => {
    expect(stripHtml('<span>a</span>b<span>c</span>')).toBe('abc');
  });
});
