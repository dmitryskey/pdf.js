/* Copyright 2016 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CSS_UNITS, NullL10n } from './ui_utils';
import { getDocument, SVGGraphics } from 'pdfjs-lib';
import { PDFPrintServiceFactory, PDFViewerApplication } from './app';

let activeService = null;
let overlayManager = null;

// Renders the page to the SVG format.
function renderPage(pdfDocument, pageNumber, size) {
  return pdfDocument.getPage(pageNumber).then((pdfPage) => {
    let viewport = pdfPage.getViewport(CSS_UNITS, size.rotation);
    const offset = 20;
    viewport.height -= offset;
    viewport.y += offset;

    return pdfPage.getOperatorList().then((opList) => {
      let svgGfx = new SVGGraphics(pdfPage.commonObjs, pdfPage.objs);
      return svgGfx.getSVG(opList, viewport);
    });
  });
}

function PDFPrintService(pdfDocument, pagesOverview, printContainer, l10n) {
  this.pdfDocument = pdfDocument;
  this.pagesOverview = pagesOverview;
  this.printContainer = printContainer;
  this.l10n = l10n || NullL10n;
  this.currentPage = -1;
}

PDFPrintService.prototype = {
  layout() {
    this.throwIfInactive();

    const body = document.querySelector('body');
    body.setAttribute('data-pdfjsprinting', true);

    let hasEqualPageSizes = this.pagesOverview.every((size) => {
      return size.width === this.pagesOverview[0].width &&
             size.height === this.pagesOverview[0].height;
    }, this);
    if (!hasEqualPageSizes) {
      console.warn('Not all pages have the same size. The printed ' +
                   'result may be incorrect!');
    }

    // Insert a @page + size rule to make sure that the page size is correctly
    // set. Note that we assume that all pages have the same size, because
    // variable-size pages are not supported yet (e.g. in Chrome & Firefox).
    // TODO(robwu): Use named pages when size calculation bugs get resolved
    // (e.g. https://crbug.com/355116) AND when support for named pages is
    // added (http://www.w3.org/TR/css3-page/#using-named-pages).
    // In browsers where @page + size is not supported (such as Firefox,
    // https://bugzil.la/851441), the next stylesheet will be ignored and the
    // user has to select the correct paper size in the UI if wanted.
    this.pageStyleSheet = document.createElement('style');
    let pageSize = this.pagesOverview[0];
    this.pageStyleSheet.textContent =
      // "size:<width> <height>" is what we need. But also add "A4" because
      // Firefox incorrectly reports support for the other value.
      '@supports ((size:A4) and (size:1pt 1pt)) {' +
      '@page { size: ' + pageSize.width + 'pt ' + pageSize.height + 'pt;}' +
      '}';
    body.appendChild(this.pageStyleSheet);
  },

  destroy() {
    if (activeService !== this) {
      // |activeService| cannot be replaced without calling destroy() first,
      // so if it differs then an external consumer has a stale reference to
      // us.
      return;
    }
    this.printContainer.textContent = '';

    const body = document.querySelector('body');
    body.removeAttribute('data-pdfjsprinting');

    if (this.pageStyleSheet) {
      this.pageStyleSheet.remove();
      this.pageStyleSheet = null;
    }
    activeService = null;
    ensureOverlay().then(() => {
      if (overlayManager.active !== 'printServiceOverlay') {
        return; // overlay was already closed
      }
      overlayManager.close('printServiceOverlay');
    });
  },

  renderPages() {
    let pageCount = this.pagesOverview.length;

    renderProgress(0, pageCount + 1, this.l10n);

    return new Promise((resolve, reject) => {
      let xhr = new XMLHttpRequest();
      xhr.open('POST', PDFViewerApplication.transformationService.url);

      xhr.setRequestHeader('Content-Type', 'application/json');

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          renderProgress(1, pageCount + 1, this.l10n);

          try {
            const respJson = JSON.parse(xhr.response);

            PDFViewerApplication.transformationService.session_id = respJson.session_id;

            if (!respJson.form) {
              reject(new Error({
                status: 500,
                statusText: 'Null PDF document',
              }));
            } else {
              let binary_string = atob(respJson.form);
              let len = binary_string.length;
              let pdfData = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                pdfData[i] = binary_string.charCodeAt(i);
              }

              getDocument(pdfData).promise.then((pdfDocument) => {
                let renderNextPage = () => {
                  this.throwIfInactive();

                  if (++this.currentPage >= pageCount) {
                    renderProgress(pageCount + 1, pageCount + 1, this.l10n);
                    resolve();
                    return;
                  }

                  let index = this.currentPage;

                  renderProgress(index + 1, pageCount + 1, this.l10n);

                  // for the last page reduce its height in order to suppress
                  // the blank page
                  renderPage(pdfDocument, index + 1, this.pagesOverview[index])
                    .then((svg) => {
                    this.throwIfInactive();

                    svg.style.zoom = (CSS_UNITS * 100) + '%';
                    this.printContainer.appendChild(svg);

                    renderNextPage();
                  });
                };

                renderNextPage();
              }, PDFViewerApplication.handleException);
            }
          } catch (ex) {
            reject(new Error({
              status: 500,
              statusText: ex,
            }));
          }
        } else {
          reject(new Error({
            status: xhr.status,
            statusText: xhr.statusText,
          }));
        }
      };

      xhr.onerror = () => {
        reject(new Error({
          status: xhr.status,
          statusText: xhr.statusText,
        }));
      };

      PDFViewerApplication.fields_data.session_id =
          PDFViewerApplication.transformationService.session_id;
      xhr.send(JSON.stringify(PDFViewerApplication.transformationService.fields_data));
    });
  },

  performPrint() {
    this.throwIfInactive();
    let printQuery = window.matchMedia('print');

    return new Promise((resolve) => {
      if (!this.active) {
        resolve();
        return;
      }

      const isSafari = /Apple/.test(navigator.vendor);

      if (isSafari) {
        // this is a workaround for the Safari. It needs SVG definitions
        // to be reloaded in order to show flatten fields.
        let svgDefs = this.printContainer.getElementsByTagName('svg:defs');

        for (let i = 0; i < svgDefs.length; i++) {
          let svgDefsHtml = svgDefs[i].innerHTML;

          // eslint-disable-next-line no-unsanitized/property
          svgDefs[i].innerHTML = svgDefsHtml;
        }

        let printListener = () => {
          setTimeout(() => {
            printQuery.removeListener(printListener);
            resolve();
          }, 1000);
        };

        printQuery.addListener(printListener);
      }

      print.call(window);

      if (!isSafari) {
        // Delay promise resolution in case print() was not synchronous.
        setTimeout(resolve, 20);  // Tidy-up.
      }
    });
  },

  get active() {
    return this === activeService;
  },

  throwIfInactive() {
    if (!this.active) {
      throw new Error('This print request was cancelled or completed.');
    }
  },
};

let print = window.print;

window.print = () => {
  if (activeService) {
    console.warn('Ignored window.print() because of a pending print job.');
    return;
  }

  ensureOverlay().then(() => {
    if (activeService) {
      overlayManager.open('printServiceOverlay');
    }
  });

  try {
    dispatchEvent('beforeprint');
  } finally {
    if (!activeService) {
      console.error('Expected print service to be initialized.');
      ensureOverlay().then(() => {
        if (overlayManager.active === 'printServiceOverlay') {
          overlayManager.close('printServiceOverlay');
        }
      });
      return; // eslint-disable-line no-unsafe-finally
    }
    let activeServiceOnEntry = activeService;
    activeService.renderPages().then(() => {
      return activeServiceOnEntry.performPrint();
    }).catch((e) => {
      // Ignore any error messages.
    }).then(() => {
      // aborts acts on the "active" print request, so we need to check
      // whether the print request (activeServiceOnEntry) is still active.
      // Without the check, an unrelated print request (created after aborting
      // this print request while the pages were being generated) would be
      // aborted.
      if (activeServiceOnEntry.active) {
        abort();
      }
    });
  }
};

function dispatchEvent(eventType) {
  let event = document.createEvent('CustomEvent');
  event.initCustomEvent(eventType, false, false, 'custom');
  window.dispatchEvent(event);
}

function abort() {
  if (activeService) {
    activeService.destroy();
    dispatchEvent('afterprint');
  }
}

function renderProgress(index, total, l10n) {
  let progressContainer = document.getElementById('printServiceOverlay');
  let progress = Math.round(100 * index / total);
  let progressBar = progressContainer.querySelector('progress');
  let progressPerc = progressContainer.querySelector('.relative-progress');
  progressBar.value = progress;
  l10n.get('print_progress_percent', { progress, }, progress + '%').
      then((msg) => {
    progressPerc.textContent = msg;
  });
}

let hasAttachEvent = !!document.attachEvent;

window.addEventListener('keydown', (event) => {
  // Intercept Cmd/Ctrl + P in all browsers.
  // Also intercept Cmd/Ctrl + Shift + P in Chrome and Opera
  if (event.keyCode === /* P= */ 80 && (event.ctrlKey || event.metaKey) &&
      !event.altKey && (!event.shiftKey || window.chrome || window.opera)) {
    window.print();
    if (hasAttachEvent) {
      // Only attachEvent can cancel Ctrl + P dialog in IE <=10
      // attachEvent is gone in IE11, so the dialog will re-appear in IE11.
      return;
    }
    event.preventDefault();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    } else {
      event.stopPropagation();
    }
  }
}, true);
if (hasAttachEvent) {
  // eslint-disable-next-line consistent-return
  document.attachEvent('onkeydown', function(event) {
    event = event || window.event;
    if (event.keyCode === /* P= */ 80 && event.ctrlKey) {
      event.keyCode = 0;
      return false;
    }
  });
}

if ('onbeforeprint' in window) {
  // Do not propagate before/afterprint events when they are not triggered
  // from within this polyfill. (FF /IE / Chrome 63+).
  let stopPropagationIfNeeded = (event) => {
    if (event.detail !== 'custom' && event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener('beforeprint', stopPropagationIfNeeded);
  window.addEventListener('afterprint', stopPropagationIfNeeded);
}

let overlayPromise;
function ensureOverlay() {
  if (!overlayPromise) {
    overlayManager = PDFViewerApplication.overlayManager;
    if (!overlayManager) {
      throw new Error('The overlay manager has not yet been initialized.');
    }

    overlayPromise = overlayManager.register('printServiceOverlay',
      document.getElementById('printServiceOverlay'), abort, true);
    document.getElementById('printCancel').onclick = abort;
  }
  return overlayPromise;
}

PDFPrintServiceFactory.instance = {
  supportsPrinting: true,

  createPrintService(pdfDocument, pagesOverview, printContainer, l10n) {
    if (activeService) {
      throw new Error('The print service is created and active.');
    }
    activeService = new PDFPrintService(pdfDocument, pagesOverview,
                                        printContainer, l10n);
    return activeService;
  },
};

export {
  PDFPrintService,
};
