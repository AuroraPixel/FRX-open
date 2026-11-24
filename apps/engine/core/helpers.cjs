/* Shared helpers: calls to a model (genericApiCall, genericApiCallStream), the regex rules the
 * player sets for prompts and replies, and HTML to text.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 2632
        function extractMainContent(htmlString) {
          if (!htmlString) return '';

          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = htmlString;

          const injections = [
            { src: 'f-event-source', target: 'f-event-target', type: 'f-layer' },
            { src: 'w-event-source', target: 'w-event-target', type: 'event' },
            { src: 'x-event-source', target: 'x-event-target', type: 'event' },
            { src: 'g-event-source', target: 'g-event-target', type: 'news' },
            { src: 'blood-source', target: 'blood-target', type: 'blood' },
            { src: 'gossip-source', target: 'gossip-target', type: 'gossip' },
            { src: 'garden-source', target: 'garden-grid-target', type: 'garden' },
            { src: 'langgan-others-source', target: 'langgan-others-target', type: 'rank' },
            { src: 'beauty-others-source', target: 'beauty-others-target', type: 'rank' },
            { src: 'treasure-others-source', target: 'treasure-others-target', type: 'rank' },
            { src: 'power-others-source', target: 'power-others-target', type: 'rank' },
            { src: 'inf-others-source', target: 'inf-others-target', type: 'rank' },
          ];

          const cleanStr = s => (s || '').replace(/[\[\]]/g, '').trim();

          injections.forEach(({ src, target, type }) => {
            const sEl = tempDiv.querySelector(`#${src}`);
            const tEl = tempDiv.querySelector(`#${target}`);

            if (sEl && tEl) {
              const rawLines = sEl.innerHTML.trim().split('\n');

              rawLines.forEach(line => {
                line = line.trim();
                if (!line || line === 'none' || line.includes('null') || line.toLowerCase().includes('none')) return;

                let parts = [];
                if (line.includes('][')) {
                  parts = line
                    .replace(/^\[|\]$/g, '')
                    .split('][')
                    .map(x => x.trim());
                } else {
                  parts = line.split('|').map(x => x.trim());
                }

                let content = '';

                if (type === 'event') {
                  const title = parts[1];
                  if (!title) return;

                  const status = parts[2] || '进行中';
                  const reward = parts[3] ? `(奖: ${parts[3]})` : '';
                  const desc = parts[4] || '';

                  content = `• ${title} [${status}] ${reward}\n  ${desc}`;
                } else if (type === 'f-layer') {
                  if (parts.length >= 2) content = `• ${parts[1]} [${parts[2]} ${parts[3]}] ${parts[4] || ''}`;
                } else if (type === 'factor') {
                  if (parts.length >= 2) content = `• [因子] ${parts[0]}: ${parts[1]}`;
                } else if (type === 'blood') {
                  content = `• [悬赏] ${parts[1]} (赏金:${parts[2]}) 委托:${parts[3]}\n  目标:${parts[4]}`;
                } else if (type === 'garden') {
                  // 只要不是系统保留字段，就无视类型名称，通通提取
                  if (!line.includes('GARDEN_P')) {
                    let name = parts[1] || '未命名对象';
                    let age_or_progress = parts[2] || '';
                    let status = parts[3] || '';

                    // 把 "灵植" 这个硬编码前缀去掉，改为直接显示名称
                    let info = `• [${name}] ${age_or_progress ? '(' + age_or_progress + ')' : ''} ${
                      status ? '状态:' + status : ''
                    }`;

                    // 动态追加所有后续描述字段（parts[5], parts[6]...）
                    if (parts[5]) info += `\n  > ${parts[5]}`;
                    if (parts[6]) info += `\n  > ${parts[6]}`;

                    content = info;
                  }
                } else if (type === 'rank') {
                  const rankText = line
                    .replace(/^\d+\./, '')
                    .replace(/\|/g, ' ')
                    .trim();
                  if (rankText.length > 2) {
                    content = `• ${rankText}`;
                  }
                } else {
                  const text = parts.slice(1).join(' - ');
                  if (text) content = `• ${text}`;
                }

                if (content) {
                  const p = document.createElement('p');
                  p.innerText = content;
                  tEl.appendChild(p);
                }
              });
            }
          });

          const trashSelectors = [
            'style',
            'script',
            'svg',
            'button',
            'nav',
            '.modal-close-btn',
            '.toast-close-btn',
            '.theme-switcher',
            '.view-toggle',
            '.more-btn',
            '.blind-box-container',
            '.meta',
            '.theme-toggle',
          ];
          tempDiv.querySelectorAll(trashSelectors.join(',')).forEach(el => el.remove());

          const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
          let currentNode;
          while ((currentNode = walker.nextNode())) {
            const val = currentNode.nodeValue.trim();
            if (val.toLowerCase().includes('none') || /^[\.·\-_\s]*$/.test(val)) {
              currentNode.nodeValue = '';
            }
          }

          function getDeepText(node) {
            if (node.nodeType === Node.TEXT_NODE) {
              return node.nodeValue;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
              const style = node.getAttribute('style');
              if (style && style.includes('display: none')) return '';

              const tagName = node.tagName.toLowerCase();
              if (tagName === 'input' || tagName === 'textarea') {
                const val = node.value || node.getAttribute('value') || '';
                if (node.type === 'checkbox' || node.type === 'radio') return '';
                return val ? ` ${val} ` : '';
              }
              if (tagName === 'img') {
                const alt = node.getAttribute('alt');
                return alt ? ` [图片:${alt}] ` : '';
              }

              let childText = '';
              node.childNodes.forEach(child => {
                childText += getDeepText(child);
              });

              if (tagName === 'br') return '\n';

              const blockTags = ['div', 'p', 'h1', 'h2', 'h3', 'li', 'header', 'section'];
              if (blockTags.includes(tagName) && childText.trim()) {
                return `\n${childText}\n`;
              }
              return childText;
            }
            return '';
          }

          let text = getDeepText(tempDiv);

          text = text.replace(
            /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/gu,
            '',
          );

          text = text
            .replace(/▼/g, '')
            .replace(/\|/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/[ \t]+/g, ' ');

          return text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
        }

// app.js 4993
        const PLACEMENT_MAP = {
          USER_INPUT: 0,
          AI_OUTPUT: 2,
          WORLD_INFO: 4,
          REASONING: 5,
          PROMPT_HISTORY: 6,
        };

// app.js 13325
        async function genericApiCallStream(apiUrl, apiKey, model, messages, signal, useGeminiBuild, streamElement) {
          if (streamElement) streamElement.textContent = '';
          const base = apiUrl.replace(/\/$/, '');
          const response = await fetch(base.replace(/\/v1$/, '') + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: true }),
            signal,
          });
          return FRX.readSSE(response, delta => {
            if (streamElement) streamElement.append(document.createTextNode(delta));
          });
        }

// app.js 25925
        async function genericApiCall(apiUrl, apiKey, model, prompt, signal = null) {
          if (!apiUrl || !model || !prompt) {
            throw new Error('通用 API 调用缺少必需的参数：URL、模型或提示词。');
          }

          let cleanedApiUrl = apiUrl.replace(/\/$/, '');
          if (!cleanedApiUrl.endsWith('/v1')) {
            cleanedApiUrl += '/v1';
          }
          const fetchUrl = cleanedApiUrl.endsWith('/chat/completions')
            ? cleanedApiUrl
            : `${cleanedApiUrl}/chat/completions`;

          try {
            let messages = [];
            if (Array.isArray(prompt)) {
              messages = prompt;
            } else {
              messages = [{ role: 'user', content: prompt }];
            }
            const requestBody = { model, messages };

            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
              headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const fetchOptions = {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(requestBody),
              signal: signal,
            };

            const response = await fetch(fetchUrl, fetchOptions);

            if (!response.ok) {
              const errorText = await response.text();
              let errorDetail = '未知错误';
              try {
                const errorJson = JSON.parse(errorText);
                errorDetail = errorJson.error?.message || errorText;
              } catch (e) {
                errorDetail = errorText;
              }
              throw new Error(`API 请求失败 (${response.status}): ${errorDetail}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (content === undefined || content === null) {
              const finishReason = data.choices?.[0]?.finish_reason;
              if (finishReason && finishReason !== 'stop') {
                throw new Error(`请求因'${finishReason}'而中断，可能由于内容安全策略或模型限制。`);
              }
              throw new Error('从 OpenAI 兼容 API 返回的响应结构无效或内容为空。');
            }
            return content;
          } catch (error) {
            if (error.name === 'AbortError') {
              throw error;
            }
            console.error('API 调用时发生错误:', error);
            throw error;
          }
        }

// app.js 28281
        function parseRegexString(regexString) {
          const lastSlash = regexString.lastIndexOf('/');
          if (regexString.startsWith('/') && lastSlash > 0) {
            const pattern = regexString.substring(1, lastSlash);
            const flags = regexString.substring(lastSlash + 1);
            return { pattern, flags };
          }
          return { pattern: regexString, flags: 'g' };
        }

// app.js 28291
        function processTextWithRules(text, scope, type) {
          let processedText = text;
          const rules = type === 'chain' ? regexConfig.chainRules || [] : regexConfig.rules || [];

          rules.forEach(rule => {
            if (!rule.disabled && rule.placement && rule.placement.includes(scope)) {
              try {
                const { pattern, flags } = parseRegexString(rule.findRegex);
                const regex = new RegExp(pattern, flags);

                processedText = processedText.replace(regex, (...args) => {
                  const captures = args.slice(1, -2);
                  let replacement = rule.replaceString;

                  replacement = replacement.replace(/\$&/g, args[0]);

                  for (let i = captures.length; i > 0; i--) {
                    if (captures[i - 1] !== undefined) {
                      replacement = replacement.replace(new RegExp(`\\$${i}`, 'g'), captures[i - 1]);
                    }
                  }

                  replacement = replacement.replace(/\$\$/g, '$');

                  return replacement;
                });
              } catch (e) {
                console.error(`无效的${type}正则表达式: ${rule.findRegex}`, e);
              }
            }
          });

          return processedText;
        }

module.exports = {
  extractMainContent,
  PLACEMENT_MAP,
  genericApiCallStream,
  genericApiCall,
  parseRegexString,
  processTextWithRules,
};
