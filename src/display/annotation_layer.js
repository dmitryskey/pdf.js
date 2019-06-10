/* Copyright 2014 Mozilla Foundation
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

import {
  addLinkAttributes, DOMSVGFactory, getFilenameFromUrl, LinkTarget,
  PDFDateString
} from './display_utils';
import {
  AnnotationBorderStyleType, AnnotationCheckboxType, AnnotationType,
  stringToPDFString, unreachable, Util, warn
} from '../shared/util';

/**
 * @typedef {Object} AnnotationElementParameters
 * @property {Object} data
 * @property {HTMLDivElement} layer
 * @property {PDFPage} page
 * @property {PageViewport} viewport
 * @property {IPDFLinkService} linkService
 * @property {DownloadManager} downloadManager
 * @property {string} imageResourcesPath - (optional) Path for image resources,
 *   mainly for annotation icons. Include trailing slash.
 * @property {boolean} renderInteractiveForms
 * @property {Object} svgFactory
 */

class AnnotationElementFactory {
  /**
   * @param {AnnotationElementParameters} parameters
   * @returns {AnnotationElement}
   */
  static create(parameters) {
    let subtype = parameters.data.annotationType;

    switch (subtype) {
      case AnnotationType.LINK:
        return new LinkAnnotationElement(parameters);

      case AnnotationType.TEXT:
        return new TextAnnotationElement(parameters);

      case AnnotationType.WIDGET:
        let fieldType = parameters.data.fieldType;

        switch (fieldType) {
          case 'Tx':
            return new TextWidgetAnnotationElement(parameters);
          case 'Btn':
            if (parameters.data.radioButton) {
              return new RadioButtonWidgetAnnotationElement(parameters);
            } else if (parameters.data.checkBox) {
              return new CheckboxWidgetAnnotationElement(parameters);
            }
            return new PushButtonWidgetAnnotationElement(parameters);
          case 'Ch':
            return new ChoiceWidgetAnnotationElement(parameters);
        }
        return new WidgetAnnotationElement(parameters);

      case AnnotationType.POPUP:
        return new PopupAnnotationElement(parameters);

      case AnnotationType.FREETEXT:
        return new FreeTextAnnotationElement(parameters);

      case AnnotationType.LINE:
        return new LineAnnotationElement(parameters);

      case AnnotationType.SQUARE:
        return new SquareAnnotationElement(parameters);

      case AnnotationType.CIRCLE:
        return new CircleAnnotationElement(parameters);

      case AnnotationType.POLYLINE:
        return new PolylineAnnotationElement(parameters);

      case AnnotationType.CARET:
        return new CaretAnnotationElement(parameters);

      case AnnotationType.INK:
        return new InkAnnotationElement(parameters);

      case AnnotationType.POLYGON:
        return new PolygonAnnotationElement(parameters);

      case AnnotationType.HIGHLIGHT:
        return new HighlightAnnotationElement(parameters);

      case AnnotationType.UNDERLINE:
        return new UnderlineAnnotationElement(parameters);

      case AnnotationType.SQUIGGLY:
        return new SquigglyAnnotationElement(parameters);

      case AnnotationType.STRIKEOUT:
        return new StrikeOutAnnotationElement(parameters);

      case AnnotationType.STAMP:
        return new StampAnnotationElement(parameters);

      case AnnotationType.FILEATTACHMENT:
        return new FileAttachmentAnnotationElement(parameters);

      default:
        return new AnnotationElement(parameters);
    }
  }
}

class AnnotationElement {
  constructor(parameters, isRenderable = false, ignoreBorder = false) {
    this.isRenderable = isRenderable;
    this.data = parameters.data;
    this.layer = parameters.layer;
    this.page = parameters.page;
    this.viewport = parameters.viewport;
    this.linkService = parameters.linkService;
    this.downloadManager = parameters.downloadManager;
    this.imageResourcesPath = parameters.imageResourcesPath;
    this.renderInteractiveForms = parameters.renderInteractiveForms;
    this.svgFactory = parameters.svgFactory;

    if (isRenderable) {
      this.container = this._createContainer(ignoreBorder);
    }
  }

  /**
   * Create an empty container for the annotation's HTML element.
   *
   * @private
   * @param {boolean} ignoreBorder
   * @memberof AnnotationElement
   * @returns {HTMLSectionElement}
   */
  _createContainer(ignoreBorder = false) {
    let data = this.data, page = this.page, viewport = this.viewport;
    let container = document.createElement('section');
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];

    container.setAttribute('data-annotation-id', data.id);

    // Do *not* modify `data.rect`, since that will corrupt the annotation
    // position on subsequent calls to `_createContainer` (see issue 6804).
    let rect = Util.normalizeRect([
      data.rect[0],
      page.view[3] - data.rect[1] + page.view[1],
      data.rect[2],
      page.view[3] - data.rect[3] + page.view[1]
    ]);

    if (!ignoreBorder && data.borderStyle.width > 0 && data.borderColor) {
      container.style.borderWidth = data.borderStyle.width + 'px';
      if (data.borderStyle.style !== AnnotationBorderStyleType.UNDERLINE) {
        // Underline styles only have a bottom border, so we do not need
        // to adjust for all borders. This yields a similar result as
        // Adobe Acrobat/Reader.
        width = width - 2 * data.borderStyle.width;
        height = height - 2 * data.borderStyle.width;
      }

      let horizontalRadius = data.borderStyle.horizontalCornerRadius;
      let verticalRadius = data.borderStyle.verticalCornerRadius;
      if (horizontalRadius > 0 || verticalRadius > 0) {
        let radius = horizontalRadius + 'px / ' + verticalRadius + 'px';
        container.style.borderRadius = radius;
      }

      switch (data.borderStyle.style) {
        case AnnotationBorderStyleType.SOLID:
        case AnnotationBorderStyleType.INSET:
        case AnnotationBorderStyleType.BEVELED:
          // border styles 'inset' and 'beveled' are applied
          // to the underlying control
          container.style.borderStyle = 'solid';
          break;

        case AnnotationBorderStyleType.DASHED:
          container.style.borderStyle = 'dashed';
          break;

        case AnnotationBorderStyleType.UNDERLINE:
          container.style.borderBottomStyle = 'solid';
          break;

        default:
          break;
      }

      if (data.borderColor) {
        container.style.borderColor =
          Util.makeCssRgb(data.borderColor[0] | 0,
                          data.borderColor[1] | 0,
                          data.borderColor[2] | 0);
      } else if (data.color) {
        container.style.borderColor =
          Util.makeCssRgb(data.color[0] | 0,
                          data.color[1] | 0,
                          data.color[2] | 0);
      } else {
        // Transparent (invisible) border, so do not draw it at all.
        container.style.borderWidth = 0;
      }
    }

    let scaleX = viewport.transform[0];
    let scaleY = viewport.transform[3];

    container.style.left = rect[0] * scaleX + 'px';
    container.style.top = rect[1] * scaleY + 'px';

    container.style.width = width * scaleX + 'px';
    container.style.height = height * scaleY + 'px';

    container.setAttribute('scale', scaleX);

    return container;
  }

  /**
   * Create a popup for the annotation's HTML element. This is used for
   * annotations that do not have a Popup entry in the dictionary, but
   * are of a type that works with popups (such as Highlight annotations).
   *
   * @private
   * @param {HTMLSectionElement} container
   * @param {HTMLDivElement|HTMLImageElement|null} trigger
   * @param {Object} data
   * @memberof AnnotationElement
   */
  _createPopup(container, trigger, data) {
    // If no trigger element is specified, create it.
    if (!trigger) {
      trigger = document.createElement('div');
      trigger.style.height = container.style.height;
      trigger.style.width = container.style.width;
      container.appendChild(trigger);
    }

    let popupElement = new PopupElement({
      container,
      trigger,
      color: data.color,
      title: data.title,
      modificationDate: data.modificationDate,
      contents: data.contents,
      hideWrapper: true,
    });
    let popup = popupElement.render();

    // Position the popup next to the annotation's container.
    popup.style.left = container.style.width;

    container.appendChild(popup);
  }

  /**
   * Render the annotation's HTML element in the empty container.
   *
   * @public
   * @memberof AnnotationElement
   */
  render() {
    unreachable('Abstract method `AnnotationElement.render` called');
  }
}

class LinkAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.url || parameters.data.dest ||
                          parameters.data.action);
    super(parameters, isRenderable);
  }

  /**
   * Render the link annotation's HTML element in the empty container.
   *
   * @public
   * @memberof LinkAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'linkAnnotation';

    let { data, linkService, } = this;
    let link = document.createElement('a');

    addLinkAttributes(link, {
      url: data.url,
      target: (data.newWindow ?
               LinkTarget.BLANK : linkService.externalLinkTarget),
      rel: linkService.externalLinkRel,
    });

    if (!data.url) {
      if (data.action) {
        this._bindNamedAction(link, data.action);
      } else {
        this._bindLink(link, data.dest);
      }
    }

    this.container.appendChild(link);
    return this.container;
  }

  /**
   * Bind internal links to the link element.
   *
   * @private
   * @param {Object} link
   * @param {Object} destination
   * @memberof LinkAnnotationElement
   */
  _bindLink(link, destination) {
    link.href = this.linkService.getDestinationHash(destination);
    link.onclick = () => {
      if (destination) {
        this.linkService.navigateTo(destination);
      }
      return false;
    };
    if (destination) {
      link.className = 'internalLink';
    }
  }

  /**
   * Bind named actions to the link element.
   *
   * @private
   * @param {Object} link
   * @param {Object} action
   * @memberof LinkAnnotationElement
   */
  _bindNamedAction(link, action) {
    link.href = this.linkService.getAnchorUrl('');
    link.onclick = () => {
      this.linkService.executeNamedAction(action);
      return false;
    };
    link.className = 'internalLink';
  }
}

class TextAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable);
  }

  /**
   * Render the text annotation's HTML element in the empty container.
   *
   * @public
   * @memberof TextAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'textAnnotation';

    let image = document.createElement('img');
    image.style.height = this.container.style.height;
    image.style.width = this.container.style.width;
    image.src = this.imageResourcesPath + 'annotation-' +
      this.data.name.toLowerCase() + '.svg';
    image.alt = '[{{type}} Annotation]';
    image.dataset.l10nId = 'text_annotation_type';
    image.dataset.l10nArgs = JSON.stringify({ type: this.data.name, });

    if (!this.data.hasPopup) {
      this._createPopup(this.container, image, this.data);
    }

    this.container.appendChild(image);
    return this.container;
  }
}

class WidgetAnnotationElement extends AnnotationElement {
  /**
   * Render the widget annotation's HTML element in the empty container.
   *
   * @public
   * @memberof WidgetAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    // Show only the container for unsupported field types.
    return this.container;
  }

  /**
   * Set element background color
   *
   * @protected
   * @param {HTMLElement} element
   * @param {Object} color
   * @memberof WidgetAnnotationElement
   */
  _setBackgroundColor(element, color) {
    if (color && color.length >= 3) {
      let bgColor = Util.makeCssRgb(
        color[0] | 0,
        color[1] | 0,
        color[2] | 0);

      element.style.backgroundColor = bgColor;
    }
  }

  /**
   * Get default font namer
   *
   * @protected
   * @memberof WidgetAnnotationElement
   * @returns {String}
   */
  _getDefaultFontName() {
    return 'Helvetica, sans-serif';
  }

   /**
   * Get container scale factor.
   *
   * @protected
   * @memberof WidgetAnnotationElement
   * @returns {Float}
   */
  _getScale() {
    return parseFloat(this.container.getAttribute('scale'));
  }

  /**
   * Measure annotation's text
   *
   * @protected
   * @param {String} line of text
   * @param {String} text font
   * @memberof WidgetAnnotationElement
   * @returns {TextMetrics}
   */
  _measureText(text, font) {
    let canvas = document.getElementById('page' + this.page.pageNumber);
    if (canvas) {
      let ctx = canvas.getContext('2d');
      ctx.font = font;
      return ctx.measureText(text);
    }

    return null;
  }

  /**
   * Process duplicate annotations
   *
   * @protected
   * @param {WidgetAnnotationElement} annotation
   * @param {Function} callback function
   * @memberof WidgetAnnotationElement
   */
  _processDuplicates(annotation, callback) {
    this.layer.querySelectorAll('[annotation-name="' +
      annotation.getAttribute('annotation-name') + '"][annotation-value="' +
      annotation.getAttribute('annotation-value') + '"]')
        .forEach((a) => {
          if (a !== annotation) {
            callback(annotation, a);
          }
        });
  }

  /**
   * Calculate font auto size.
   *
   * @private
   * @param {HTMLDivElement} element
   * @param {String} text
   * @memberof WidgetAnnotationElement
   * @returns {String}
   */
  _calculateFontAutoSize(element, text, offset) {
    let style = element.style;
    let maxHeight = parseInt(element.offsetHeight);
    offset = offset || 0;

    let fSize = 2;
    let sizeStep = 0.1;
    for (fSize = 2; fSize < maxHeight * 0.8; fSize += sizeStep) {
      let m = this._measureText(text,
        (style.fontStyle ? style.fontStyle + ' ' : '') +
        (style.fontWeight ? style.fontWeight + ' ' : '') +
        fSize + 'px ' +
        (this.fontFamily || this._getDefaultFontName()));

      if (m.width + offset > parseInt(element.offsetWidth)) {
        break;
      }
    }

    return (fSize - sizeStep) + 'px';
  }

  /**
   * Get style of the checkbox or radiobutton.
   *
   * @private
   * @param {Object} type
   * @memberof WidgetAnnotationElement
   * @returns {String}
   */
  _getCheckBoxStyle(type) {
    switch (type) {
      case AnnotationCheckboxType.CHECK:
        return 'check';
      case AnnotationCheckboxType.CIRCLE:
        return 'circle';
      case AnnotationCheckboxType.CROSS:
        return 'cross';
      case AnnotationCheckboxType.DIAMOND:
        return 'diamond';
      case AnnotationCheckboxType.SQUARE:
        return 'square';
      case AnnotationCheckboxType.STAR:
        return 'star';
      default:
        return '';
    }
  }

  /**
   * Get checkmark/radio button symbols.
   *
   * @private
   * @memberof WidgetAnnotationElement
   * @returns {Array}
   */
  _getCheckmarkSymbols() {
    let checkMarkSymbols = [];
    checkMarkSymbols[AnnotationCheckboxType.CHECK] = '✓';
    checkMarkSymbols[AnnotationCheckboxType.CIRCLE] = '●';
    checkMarkSymbols[AnnotationCheckboxType.CROSS] = '✕';
    checkMarkSymbols[AnnotationCheckboxType.DIAMOND] = '◆';
    checkMarkSymbols[AnnotationCheckboxType.SQUARE] = '■';
    checkMarkSymbols[AnnotationCheckboxType.STAR] = '★';
    return checkMarkSymbols;
  }
}

class TextWidgetAnnotationElement extends WidgetAnnotationElement {
  constructor(parameters) {
    let isRenderable = parameters.renderInteractiveForms ||
      (!parameters.data.hasAppearance && !!parameters.data.fieldValue);
    super(parameters, isRenderable);
  }

  /**
   * Render the text widget annotation's HTML element in the empty container.
   *
   * @public
   * @memberof TextWidgetAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    const TEXT_ALIGNMENT = ['left', 'center', 'right'];
    this.container.className = 'textWidgetAnnotation';

    if (!this.data.readOnly) {
      this.container.title = this.data.alternativeText;
    }

    let element = null;
    let font = null;
    if (this.renderInteractiveForms) {
      // NOTE: We cannot set the values using `element.value` below, since it
      //       prevents the AnnotationLayer rasterizer in `test/driver.js`
      //       from parsing the elements correctly for the reference tests.
      if (this.data.multiLine) {
        element = document.createElement('textarea');
        element.textContent = this.data.fieldValue;
      } else {
        element = document.createElement('input');
        element.type = 'text';
        element.setAttribute('value', this.data.fieldValue);
      }

      element.setAttribute('annotation-name',
        encodeURIComponent(this.data.fieldName));

      element.disabled = this.data.readOnly;

      if (this.data.required) {
        element.setAttribute('annotation-required', true);
      }

      if (this.data.maxLen !== null) {
        element.maxLength = this.data.maxLen;
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
        element.className = 'inset';
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
        element.className = 'beveled';
      }

      if (this.data.comb) {
        let fieldWidth = this.data.rect[2] - this.data.rect[0];
        let combWidth = fieldWidth / this.data.maxLen;

        element.classList.add('comb');
        element.style.letterSpacing = 'calc(' + combWidth + 'px - 1ch)';
      }

      if (this.data.fontRefName) {
        let fonts = this.data.annotationFonts;
        for (let f = 0; f < fonts.length; f++) {
          if (fonts[f].length >= 3 &&
              fonts[f][0] === this.data.fontRefName) {
            font = fonts[f][2];
            break;
          }
        }
      }
    } else {
      element = document.createElement('div');
      element.textContent = this.data.fieldValue;
      element.style.verticalAlign = 'middle';
      element.style.display = 'table-cell';

      if (this.data.fontRefName &&
          this.page.commonObjs.has(this.data.fontRefName)) {
        font = this.page.commonObjs.get(this.data.fontRefName);
      }
    }

    this._setTextStyle(element, font);

    if (this.data.textAlignment !== null) {
      element.style.textAlign = TEXT_ALIGNMENT[this.data.textAlignment];
    }

    this._setBackgroundColor(element, this.data.backgroundColor);

    this.container.appendChild(element);
    return this.container;
  }

  /**
   * Apply text styles to the text in the element.
   *
   * @private
   * @param {HTMLDivElement} element
   * @param {Object} font
   * @memberof TextWidgetAnnotationElement
   */
  _setTextStyle(element, font) {
    // TODO: This duplicates some of the logic in CanvasGraphics.setFont().
    let style = element.style;

    if (this.data.fontColor) {
      style.color = this.data.fontColor;
    }

    if (this.data.fontSize) {
      style.fontSize = this.data.fontSize *
      this._getScale() + 'px';
    }

    if (this.data.fontDirection) {
      style.direction = (this.data.fontDirection < 0 ? 'rtl' : 'ltr');
    }

    if (font) {
      style.fontWeight = (font.black ?
        (font.bold ? '900' : 'bold') :
        (font.bold ? 'bold' : 'normal'));
      style.fontStyle = (font.italic ? 'italic' : 'normal');

      // Use a reasonable default font if the font doesn't specify a fallback.
      let fontFamily = font.loadedName ? '"' + font.loadedName + '", ' : '';
      let fallbackName = font.fallbackName || this._getDefaultFontName();
      style.fontFamily = fontFamily + fallbackName;
    }

    let self = this;

    element.onblur = () => {
      if (!style.fontSize && !self.data.multiLine) {
        style.fontSize = self._calculateFontAutoSize(element, element.value);
      }

      self._processDuplicates(element, (a, b) => {
        b.value = a.value;
      });
    };

    // Auto size
    if (!style.fontSize && !this.data.multiLine) {
      window.setTimeout((element, self) => {
        element.style.fontSize =
          self._calculateFontAutoSize(element, element.value);
      }, 100, element, this);

      element.onkeypress = () => {
        style.fontSize = self._calculateFontAutoSize(element, element.value);
      };
    }
  }
}

class CheckboxWidgetAnnotationElement extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, parameters.renderInteractiveForms);
  }

  /**
   * Render the checkbox widget annotation's HTML element
   * in the empty container.
   *
   * @public
   * @memberof CheckboxWidgetAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'buttonWidgetAnnotation checkBox ';

    if (!this.data.readOnly) {
      this.container.title = this.data.alternativeText;
    }

    let element = document.createElement('input');
    element.setAttribute('annotation-name',
      encodeURIComponent(this.data.fieldName));
    element.setAttribute('annotation-value',
      this.data.buttonValue ? encodeURIComponent(this.data.buttonValue) : '');
    element.disabled = this.data.readOnly;
    element.type = 'checkbox';
    element.checked = this.data.fieldValue && this.data.fieldValue !== 'Off';
    element.checkBoxType = this.data.checkBoxType;

    if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
      element.className = 'inset';
    }

    if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
      element.className = 'beveled';
    }

    this.container.appendChild(element);

    // We have to create a div with checkbox symbol
    // in order to deal with background color, when
    // div with text handles onclick event.
    let span = document.createElement('span');

    let checkMarkSymbols = this._getCheckmarkSymbols();

    span.innerHTML = element.checked ?
      checkMarkSymbols[element.checkBoxType] : '';

    let self = this;

    element.onchange = () => {
      span.innerHTML = element.checked ?
        checkMarkSymbols[element.checkBoxType] : '';

        self._processDuplicates(element, (a, b) => {
          if (b.parentElement) {
            b.checked = a.checked;

            let annotationSpans =
              b.parentElement.getElementsByTagName('span');

              if (annotationSpans.length > 0) {
                annotationSpans[0].innerHTML = a.checked ?
                  checkMarkSymbols[b.checkBoxType] : '';
            }
          }
        });
    };

    span.onclick = () => {
      if (!element.disabled) {
        element.checked = false;
        element.onchange();
      }
    };

    let fontSizeFactor =
        this.data.checkBoxType === AnnotationCheckboxType.CIRCLE ||
        this.data.checkBoxType === AnnotationCheckboxType.DIAMOND ||
        this.data.checkBoxType === AnnotationCheckboxType.SQUARE ? 1.5 :
        this.data.checkBoxType === AnnotationCheckboxType.STAR ? 0.5 : 1.0;

    let fontSizePadding =
        this.data.checkBoxType !== AnnotationCheckboxType.STAR &&
        (this.data.borderStyle.style === AnnotationBorderStyleType.INSET ||
        this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) ?
        4 : 0;

    span.style.lineHeight = this.container.style.height;

    span.style.fontSize = (parseFloat(this.container.style.height) *
      fontSizeFactor - fontSizePadding) + 'px';

    span.style.color = this.data.fontColor;
    this.container.className +=
      this._getCheckBoxStyle(this.data.checkBoxType);

    this._setBackgroundColor(element, this.data.backgroundColor);

    this.container.appendChild(span);

    return this.container;
  }
}

class RadioButtonWidgetAnnotationElement extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, parameters.renderInteractiveForms);
  }

  /**
   * Render the radio button widget annotation's HTML element
   * in the empty container.
   *
   * @public
   * @memberof RadioButtonWidgetAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'buttonWidgetAnnotation radioButton ';

    if (!this.data.readOnly) {
      this.container.title = this.data.alternativeText;
    }

    let element = document.createElement('input');
    element.name = encodeURIComponent(this.data.fieldName);
    element.setAttribute('annotation-name',
      encodeURIComponent(this.data.fieldName + '_' +
      (this.data.buttonValue || '')));
    element.disabled = this.data.readOnly;
    element.type = 'radio';
    if (this.data.fieldValue === this.data.buttonValue) {
      element.checked = true;
    }

    element.radioButtonType = this.data.radioButtonType;

    if (this.data.radioButtonType === AnnotationCheckboxType.CIRCLE) {
      element.style.width = this.container.style.width =
        this.container.style.height;
      this.container.borderRadius = '50%';
    }

    if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
      element.className = 'inset';
    }

    if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
      element.className = 'beveled';
    }

    this.container.appendChild(element);

    let span = document.createElement('span');

    let checkMarkSymbols = this._getCheckmarkSymbols();

    span.innerHTML = element.checked ?
      checkMarkSymbols[element.radioButtonType] : '';

    element.onchange = () => {
      span.innerHTML = checkMarkSymbols[element.radioButtonType];

      let annotations = document.getElementsByName(element.name);
      for (let index in annotations) {
        if (annotations[index] !== element &&
            annotations[index].parentElement) {
          var annotationSpans =
            annotations[index].parentElement.getElementsByTagName('span');
          if (annotationSpans.length > 0) {
            annotationSpans[0].innerHTML = '';
          }
        }
      }
    };

    let fontSizeFactor =
      this.data.radioButtonType === AnnotationCheckboxType.CIRCLE ||
      this.data.radioButtonType === AnnotationCheckboxType.DIAMOND ||
      this.data.radioButtonType === AnnotationCheckboxType.SQUARE ? 1.5 :
      this.data.radioButtonType === AnnotationCheckboxType.STAR ? 0.5 : 1.0;

    let fontSizePadding =
      this.data.radioButtonType !== AnnotationCheckboxType.STAR &&
      (this.data.borderStyle.style === AnnotationBorderStyleType.INSET ||
      this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) ?
      4 : 0;

    span.style.lineHeight = this.container.style.height;

    span.style.fontSize = (parseFloat(this.container.style.height) *
      fontSizeFactor - fontSizePadding) *
      this._getScale() + 'px';

    span.style.color = this.data.fontColor;
    this.container.className +=
      this._getCheckBoxStyle(this.data.radioButtonType);

    this._setBackgroundColor(element, this.data.backgroundColor);

    this.container.appendChild(span);

    return this.container;
  }
}

class PushButtonWidgetAnnotationElement extends LinkAnnotationElement {
  /**
   * Render the push button widget annotation's HTML element
   * in the empty container.
   *
   * @public
   * @memberof PushButtonWidgetAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    // The rendering and functionality of a push button widget annotation is
    // equal to that of a link annotation, but may have more functionality, such
    // as performing actions on form fields (resetting, submitting, et cetera).
    let container = super.render();
    container.className = 'buttonWidgetAnnotation pushButton';
    return container;
  }
}

class ChoiceWidgetAnnotationElement extends WidgetAnnotationElement {
  constructor(parameters) {
    super(parameters, parameters.renderInteractiveForms);
  }

  /**
   * Render the choice widget annotation's HTML element in the empty
   * container.
   *
   * @public
   * @memberof ChoiceWidgetAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'choiceWidgetAnnotation';

    let i, ii, style;
    let itemName = encodeURIComponent(this.data.fieldName) + '_item';

    let self = this;

    if (!this.data.combo) {
      let selectElement = document.createElement('select');
      selectElement.setAttribute('annotation-name',
        encodeURIComponent(this.data.fieldName));
      selectElement.disabled = this.data.readOnly;

      if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
        selectElement.className = 'inset';
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
        selectElement.className = 'beveled';
      }

      style = selectElement.style;

      this._setElementFont(selectElement);

      this._setBackgroundColor(selectElement, this.data.backgroundColor);

      // List boxes have a size and (optionally) multiple selection.
      selectElement.size = this.data.options.length;

      if (this.data.multiSelect) {
        selectElement.multiple = true;
      }

      // Insert the options into the choice field.
      for (i = 0, ii = this.data.options.length; i < ii; i++) {
        let option = this.data.options[i];
        let optionElement = document.createElement('option');
        optionElement.textContent = option.displayValue;
        optionElement.value = option.exportValue;
        optionElement.setAttribute('name', itemName);

        if (this.data.fieldValue.includes(option.exportValue)) {
          optionElement.setAttribute('selected', true);
        }

        selectElement.appendChild(optionElement);
      }

      selectElement.onblur = () => {
        self._processDuplicates(selectElement, (a, b) => {
          for (let i = 0; i < a.options.length; i++) {
            if (i < b.options.length) {
              b.options[i].selected = a.options[i].selected;
            }
          }
        });
      };

      this.container.appendChild(selectElement);
    } else {
      let hoverClass = 'hover';
      let showClass = 'show';

      let comboElementDiv = document.createElement('div');
      comboElementDiv.className = 'combo';
      comboElementDiv.style.height = this.container.style.height;

      let comboElement = document.createElement('input');
      comboElement.type = 'text';
      comboElement.readOnly = !this.data.customText;
      comboElement.setAttribute('annotation-name',
        encodeURIComponent(this.data.fieldName));
      comboElement.style.height = this.container.style.height;
      comboElement.style.width = this.container.style.width;

      if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
        comboElement.className = 'inset';
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
        comboElement.className = 'beveled';
      }

      style = comboElement.style;

      this._setElementFont(comboElement);

      this._setBackgroundColor(comboElement, this.data.backgroundColor);

      let comboContent = document.createElement('div');
      comboContent.className = 'combo-content';

      comboContent.onmouseover = () => {
        comboElement.selected = true;
      };

      comboContent.onmouseout = () => {
        comboElement.selected = false;
      };

      comboElement.onkeypress = (event) => {
        if ((event.keyCode ? event.keyCode : event.which) === 13) {
          comboContent.classList.remove(showClass);
          return;
        }

        let filterChar = String.fromCharCode(event.charCode).toUpperCase();

        let items = comboContent.getElementsByTagName('a');
        let selectedIndex = -1;
        let firstIndex = -1;
        let lastIndex = -1;
        let newIndex = -1;

        for (let i = 0; i < items.length; i++) {
          if (items[i].classList.contains(hoverClass) &&
            items[i].text[0].toUpperCase() === filterChar) {
            selectedIndex = i;
          }

          if (items[i].text && items[i].text.length > 0 &&
            items[i].text[0].toUpperCase() === filterChar) {
            if (firstIndex < 0) {
              firstIndex = i;
            }

            lastIndex = i;
          }

          items[i].classList.remove(hoverClass);
        }

        for (let i = 0; i < items.length; i++) {
          if (items[i].text && items[i].text.length > 0 &&
            items[i].text[0].toUpperCase() === filterChar &&
            i > selectedIndex) {
            newIndex = i;
            break;
          }
        }

        let selectedItem = null;
        let selectedItemIndex = -1;
        if (newIndex >= 0) {
          selectedItemIndex = newIndex;
        } else if (selectedIndex >= 0 && selectedIndex !== lastIndex) {
          selectedItemIndex = selectedIndex;
        } else if (firstIndex >= 0) {
          selectedItemIndex = firstIndex;
        }

        if (selectedItemIndex >= 0) {
          selectedItem = items[selectedItemIndex];
          selectedItem.classList.add(hoverClass);
          comboElement.value = selectedItem.text;

          let hRatio = comboContent.clientHeight / comboContent.scrollHeight;
          let pRatio = (selectedItemIndex + 1) / items.length;

          if (hRatio <= pRatio) {
            comboContent.scrollTop = selectedItemIndex / items.length *
              comboContent.scrollHeight;
          } else {
            comboContent.scrollTop = 0;
          }

          // Auto size
          if (comboElement.autoSize) {
            style.fontSize = self._calculateFontAutoSize(
              comboElement, selectedItem.text, downArrowWidth);
          }
        }
      };

      comboElement.onblur = () => {
        if (!comboElement.selected) {
          comboContent.classList.remove(showClass);
          self.container.style.position = '';
          self.container.style.zIndex = '';
        }

        self._processDuplicates(comboElement, (a, b) => {
          b.value = a.value;
        });
      };

      let spanElement = document.createElement('span');

      spanElement.style.fontSize = this._getScale() * 10 + 'px';

      spanElement.onclick = () => {
        if (!comboElement.disabled) {
          comboElement.focus();
          comboContent.classList.toggle(showClass);
          self.container.style.position = 'absolute';
          self.container.style.zIndex = '100';
        }
      };

      let comboWidth = parseFloat(self.container.style.width);
      let increaseComboWidth = false;

      let aElementPadding = 2;
      let downArrowWidth = self._measureText('▼',
        spanElement.style.fontSize + ' ' +
        self._getDefaultFontName()).width;

      for (i = 0, ii = this.data.options.length; i < ii; i++) {
        let optionItem = this.data.options[i];
        if (this.data.fieldValue.includes(optionItem.exportValue)) {
          comboElement.value = optionItem.displayValue;
        }

        let aElement = document.createElement('a');
        aElement.setAttribute('value', optionItem.exportValue);
        aElement.text = optionItem.displayValue;
        aElement.name = itemName;
        aElement.style.padding = aElementPadding + 'px';
        if (!style.fontSize) {
          aElement.style.fontSize = this._getScale() * 9 + 'px';
        } else {
          aElement.style.fontSize = style.fontSize;
        }

        let aElementWidth = self._measureText(aElement.text,
          (style.fontStyle ? style.fontStyle + ' ' : '') +
          (style.fontWeight ? style.fontWeight + ' ' : '') +
          (style.fontSize ? style.fontSize : '9') + 'px ' +
          (style.fontFamily || self._getDefaultFontName()));

        if (aElementWidth.width + downArrowWidth +
          aElementPadding * 2 > comboWidth) {
          comboWidth = aElementWidth.width;
          increaseComboWidth = true;
        }

        aElement.onclick = () => {
          comboElement.value = aElement.text;
          comboContent.classList.remove(showClass);
          self.container.style.position = '';
          self.container.style.zIndex = '';

          // Auto size
          if (comboElement.autoSize) {
            style.fontSize = self._calculateFontAutoSize(
              comboElement, aElement.text, downArrowWidth);
          }
        };

        aElement.onmouseover = () => {
          let items = comboContent.getElementsByTagName('a');

          for (let i = 0; i < items.length; i++) {
            items[i].classList.remove(hoverClass);
          }

          aElement.classList.add(hoverClass);
        };

        aElement.onmouseout = () => {
          aElement.classList.remove(hoverClass);
        };

        comboContent.appendChild(aElement);
      }

      if (increaseComboWidth) {
        comboContent.style.width = (comboWidth + downArrowWidth +
          aElementPadding * 2) + 'px';
      }

      if (!style.fontSize) {
        comboElement.autoSize = true;

        window.setTimeout(function(element, self, downArrowWidth) {
          element.style.fontSize =
            self._calculateFontAutoSize(element, element.value,
              downArrowWidth);
        }, 100, comboElement, this, downArrowWidth);
      }

      comboElementDiv.appendChild(comboElement);

      if (!this.data.readOnly) {
        comboElementDiv.appendChild(spanElement);
        comboElementDiv.appendChild(comboContent);
      }

      this.container.appendChild(comboElementDiv);
    }

    let styleExpression = '';

    if (this.data.backgroundColor) {
      let bgColor = Util.makeCssRgb(
        this.data.backgroundColor[0] | 0,
        this.data.backgroundColor[1] | 0,
        this.data.backgroundColor[2] | 0);

      styleExpression = 'background-color:' + bgColor + ';';
    }

    styleExpression +=
      (style.color ? 'color:' + style.color + ';' : '') +
      (style.fontSize ? 'font-size:' + style.fontSize + ';' : '') +
      (style.fontWeight ? 'font-weight:' + style.fontWeight + ';' : '') +
      (style.fontStyle ? 'font-style:' + style.fontStyle + ';' : '') +
      (style.fontFamily ? 'font-family:' + style.fontFamily + ';' : '');

    let cssClass = document.createElement('style');
    cssClass.innerHTML =
      '.' + this.layer.className + ' .' + this.container.className +
      ' [name="' + itemName + '"]{' + styleExpression + '}';

    document.body.appendChild(cssClass);

    return this.container;
  }

  /**
   * Set element font.
   *
   * @private
   * @param {HTMLElement} element
   * @memberof ChoiceWidgetAnnotationElement
   */
  _setElementFont(element) {
    let style = element.style;

    if (this.data.fontColor) {
      style.color = this.data.fontColor;
    }

    if (this.data.fontSize) {
      style.fontSize = this.data.fontSize * this._getScale() + 'px';
    }

    if (this.data.fontRefName) {
      let fonts = this.data.annotationFonts;
      for (let f = 0; f < fonts.length; f++) {
        if (fonts[f].length >= 3 && fonts[f][0] === this.data.fontRefName) {
          let font = fonts[f][2];

          style.fontWeight = font.black ? font.bold ? '900' :
                               'bold' : font.bold ? 'bold' : 'normal';
          style.fontStyle = font.italic ? 'italic' : 'normal';
          let fontFamily = font.loadedName ? '"' +
                             font.loadedName + '", ' : '';
          let fallbackName = font.fallbackName || this._getDefaultFontName();
          style.fontFamily = fontFamily + fallbackName;
          break;
        }
      }
    }
  }
}

class PopupAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable);
  }

  /**
   * Render the popup annotation's HTML element in the empty container.
   *
   * @public
   * @memberof PopupAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    // Do not render popup annotations for parent elements with these types as
    // they create the popups themselves (because of custom trigger divs).
    const IGNORE_TYPES = [
      'Line',
      'Square',
      'Circle',
      'PolyLine',
      'Polygon',
      'Ink',
    ];

    this.container.className = 'popupAnnotation';

    if (IGNORE_TYPES.includes(this.data.parentType)) {
      return this.container;
    }

    let selector = '[data-annotation-id="' + this.data.parentId + '"]';
    let parentElement = this.layer.querySelector(selector);
    if (!parentElement) {
      return this.container;
    }

    let popup = new PopupElement({
      container: this.container,
      trigger: parentElement,
      color: this.data.color,
      title: this.data.title,
      modificationDate: this.data.modificationDate,
      contents: this.data.contents,
    });

    // Position the popup next to the parent annotation's container.
    // PDF viewers ignore a popup annotation's rectangle.
    let parentLeft = parseFloat(parentElement.style.left);
    let parentWidth = parseFloat(parentElement.style.width);
    this.container.style.transformOrigin =
      -(parentLeft + parentWidth) + 'px -' + parentElement.style.top;
    this.container.style.left = (parentLeft + parentWidth) + 'px';

    this.container.appendChild(popup.render());
    return this.container;
  }
}

class PopupElement {
  constructor(parameters) {
    this.container = parameters.container;
    this.trigger = parameters.trigger;
    this.color = parameters.color;
    this.title = parameters.title;
    this.modificationDate = parameters.modificationDate;
    this.contents = parameters.contents;
    this.hideWrapper = parameters.hideWrapper || false;

    this.pinned = false;
  }

  /**
   * Render the popup's HTML element.
   *
   * @public
   * @memberof PopupElement
   * @returns {HTMLSectionElement}
   */
  render() {
    const BACKGROUND_ENLIGHT = 0.7;

    let wrapper = document.createElement('div');
    wrapper.className = 'popupWrapper';

    // For Popup annotations we hide the entire section because it contains
    // only the popup. However, for Text annotations without a separate Popup
    // annotation, we cannot hide the entire container as the image would
    // disappear too. In that special case, hiding the wrapper suffices.
    this.hideElement = (this.hideWrapper ? wrapper : this.container);
    this.hideElement.setAttribute('hidden', true);

    let popup = document.createElement('div');
    popup.className = 'popup';

    let color = this.color;
    if (color) {
      // Enlighten the color.
      let r = BACKGROUND_ENLIGHT * (255 - color[0]) + color[0];
      let g = BACKGROUND_ENLIGHT * (255 - color[1]) + color[1];
      let b = BACKGROUND_ENLIGHT * (255 - color[2]) + color[2];
      popup.style.backgroundColor = Util.makeCssRgb(r | 0, g | 0, b | 0);
    }

    let title = document.createElement('h1');
    title.textContent = this.title;
    popup.appendChild(title);

    // The modification date is shown in the popup instead of the creation
    // date if it is available and can be parsed correctly, which is
    // consistent with other viewers such as Adobe Acrobat.
    const dateObject = PDFDateString.toDateObject(this.modificationDate);
    if (dateObject) {
      const modificationDate = document.createElement('span');
      modificationDate.textContent = '{{date}}, {{time}}';
      modificationDate.dataset.l10nId = 'annotation_date_string';
      modificationDate.dataset.l10nArgs = JSON.stringify({
        date: dateObject.toLocaleDateString(),
        time: dateObject.toLocaleTimeString(),
      });
      popup.appendChild(modificationDate);
    }

    let contents = this._formatContents(this.contents);
    popup.appendChild(contents);

    // Attach the event listeners to the trigger element.
    this.trigger.addEventListener('click', this._toggle.bind(this));
    this.trigger.addEventListener('mouseover', this._show.bind(this, false));
    this.trigger.addEventListener('mouseout', this._hide.bind(this, false));
    popup.addEventListener('click', this._hide.bind(this, true));

    wrapper.appendChild(popup);
    return wrapper;
  }

  /**
   * Format the contents of the popup by adding newlines where necessary.
   *
   * @private
   * @param {string} contents
   * @memberof PopupElement
   * @returns {HTMLParagraphElement}
   */
  _formatContents(contents) {
    let p = document.createElement('p');
    let lines = contents.split(/(?:\r\n?|\n)/);
    for (let i = 0, ii = lines.length; i < ii; ++i) {
      let line = lines[i];
      p.appendChild(document.createTextNode(line));
      if (i < (ii - 1)) {
        p.appendChild(document.createElement('br'));
      }
    }
    return p;
  }

  /**
   * Toggle the visibility of the popup.
   *
   * @private
   * @memberof PopupElement
   */
  _toggle() {
    if (this.pinned) {
      this._hide(true);
    } else {
      this._show(true);
    }
  }

  /**
   * Show the popup.
   *
   * @private
   * @param {boolean} pin
   * @memberof PopupElement
   */
  _show(pin = false) {
    if (pin) {
      this.pinned = true;
    }
    if (this.hideElement.hasAttribute('hidden')) {
      this.hideElement.removeAttribute('hidden');
      this.container.style.zIndex += 1;
    }
  }

  /**
   * Hide the popup.
   *
   * @private
   * @param {boolean} unpin
   * @memberof PopupElement
   */
  _hide(unpin = true) {
    if (unpin) {
      this.pinned = false;
    }
    if (!this.hideElement.hasAttribute('hidden') && !this.pinned) {
      this.hideElement.setAttribute('hidden', true);
      this.container.style.zIndex -= 1;
    }
  }
}

class FreeTextAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(parameters.data.hasPopup ||
                            parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the free text annotation's HTML element in the empty container.
   *
   * @public
   * @memberof FreeTextAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'freeTextAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class LineAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the line annotation's HTML element in the empty container.
   *
   * @public
   * @memberof LineAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'lineAnnotation';

    // Create an invisible line with the same starting and ending coordinates
    // that acts as the trigger for the popup. Only the line itself should
    // trigger the popup, not the entire container.
    let data = this.data;
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];
    let svg = this.svgFactory.create(width, height);

    // PDF coordinates are calculated from a bottom left origin, so transform
    // the line coordinates to a top left origin for the SVG element.
    let line = this.svgFactory.createElement('svg:line');
    line.setAttribute('x1', data.rect[2] - data.lineCoordinates[0]);
    line.setAttribute('y1', data.rect[3] - data.lineCoordinates[1]);
    line.setAttribute('x2', data.rect[2] - data.lineCoordinates[2]);
    line.setAttribute('y2', data.rect[3] - data.lineCoordinates[3]);
    line.setAttribute('stroke-width', data.borderStyle.width);
    line.setAttribute('stroke', 'transparent');

    svg.appendChild(line);
    this.container.append(svg);

    // Create the popup ourselves so that we can bind it to the line instead
    // of to the entire container (which is the default).
    this._createPopup(this.container, line, data);

    return this.container;
  }
}

class SquareAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the square annotation's HTML element in the empty container.
   *
   * @public
   * @memberof SquareAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'squareAnnotation';

    // Create an invisible square with the same rectangle that acts as the
    // trigger for the popup. Only the square itself should trigger the
    // popup, not the entire container.
    let data = this.data;
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];
    let svg = this.svgFactory.create(width, height);

    // The browser draws half of the borders inside the square and half of
    // the borders outside the square by default. This behavior cannot be
    // changed programmatically, so correct for that here.
    let borderWidth = data.borderStyle.width;
    let square = this.svgFactory.createElement('svg:rect');
    square.setAttribute('x', borderWidth / 2);
    square.setAttribute('y', borderWidth / 2);
    square.setAttribute('width', width - borderWidth);
    square.setAttribute('height', height - borderWidth);
    square.setAttribute('stroke-width', borderWidth);
    square.setAttribute('stroke', 'transparent');
    square.setAttribute('fill', 'none');

    svg.appendChild(square);
    this.container.append(svg);

    // Create the popup ourselves so that we can bind it to the square instead
    // of to the entire container (which is the default).
    this._createPopup(this.container, square, data);

    return this.container;
  }
}

class CircleAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the circle annotation's HTML element in the empty container.
   *
   * @public
   * @memberof CircleAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'circleAnnotation';

    // Create an invisible circle with the same ellipse that acts as the
    // trigger for the popup. Only the circle itself should trigger the
    // popup, not the entire container.
    let data = this.data;
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];
    let svg = this.svgFactory.create(width, height);

    // The browser draws half of the borders inside the circle and half of
    // the borders outside the circle by default. This behavior cannot be
    // changed programmatically, so correct for that here.
    let borderWidth = data.borderStyle.width;
    let circle = this.svgFactory.createElement('svg:ellipse');
    circle.setAttribute('cx', width / 2);
    circle.setAttribute('cy', height / 2);
    circle.setAttribute('rx', (width / 2) - (borderWidth / 2));
    circle.setAttribute('ry', (height / 2) - (borderWidth / 2));
    circle.setAttribute('stroke-width', borderWidth);
    circle.setAttribute('stroke', 'transparent');
    circle.setAttribute('fill', 'none');

    svg.appendChild(circle);
    this.container.append(svg);

    // Create the popup ourselves so that we can bind it to the circle instead
    // of to the entire container (which is the default).
    this._createPopup(this.container, circle, data);

    return this.container;
  }
}

class PolylineAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);

    this.containerClassName = 'polylineAnnotation';
    this.svgElementName = 'svg:polyline';
  }

  /**
   * Render the polyline annotation's HTML element in the empty container.
   *
   * @public
   * @memberof PolylineAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = this.containerClassName;

    // Create an invisible polyline with the same points that acts as the
    // trigger for the popup. Only the polyline itself should trigger the
    // popup, not the entire container.
    let data = this.data;
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];
    let svg = this.svgFactory.create(width, height);

    // Convert the vertices array to a single points string that the SVG
    // polyline element expects ("x1,y1 x2,y2 ..."). PDF coordinates are
    // calculated from a bottom left origin, so transform the polyline
    // coordinates to a top left origin for the SVG element.
    let vertices = data.vertices;
    let points = [];
    for (let i = 0, ii = vertices.length; i < ii; i++) {
      let x = vertices[i].x - data.rect[0];
      let y = data.rect[3] - vertices[i].y;
      points.push(x + ',' + y);
    }
    points = points.join(' ');

    let borderWidth = data.borderStyle.width;
    let polyline = this.svgFactory.createElement(this.svgElementName);
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke-width', borderWidth);
    polyline.setAttribute('stroke', 'transparent');
    polyline.setAttribute('fill', 'none');

    svg.appendChild(polyline);
    this.container.append(svg);

    // Create the popup ourselves so that we can bind it to the polyline
    // instead of to the entire container (which is the default).
    this._createPopup(this.container, polyline, data);

    return this.container;
  }
}

class PolygonAnnotationElement extends PolylineAnnotationElement {
  constructor(parameters) {
    // Polygons are specific forms of polylines, so reuse their logic.
    super(parameters);

    this.containerClassName = 'polygonAnnotation';
    this.svgElementName = 'svg:polygon';
  }
}

class CaretAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(parameters.data.hasPopup ||
                            parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the caret annotation's HTML element in the empty container.
   *
   * @public
   * @memberof CaretAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'caretAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class InkAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);

    this.containerClassName = 'inkAnnotation';

    // Use the polyline SVG element since it allows us to use coordinates
    // directly and to draw both straight lines and curves.
    this.svgElementName = 'svg:polyline';
  }

  /**
   * Render the ink annotation's HTML element in the empty container.
   *
   * @public
   * @memberof InkAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = this.containerClassName;

    // Create an invisible polyline with the same points that acts as the
    // trigger for the popup.
    let data = this.data;
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];
    let svg = this.svgFactory.create(width, height);

    let inkLists = data.inkLists;
    for (let i = 0, ii = inkLists.length; i < ii; i++) {
      let inkList = inkLists[i];
      let points = [];

      // Convert the ink list to a single points string that the SVG
      // polyline element expects ("x1,y1 x2,y2 ..."). PDF coordinates are
      // calculated from a bottom left origin, so transform the polyline
      // coordinates to a top left origin for the SVG element.
      for (let j = 0, jj = inkList.length; j < jj; j++) {
        let x = inkList[j].x - data.rect[0];
        let y = data.rect[3] - inkList[j].y;
        points.push(x + ',' + y);
      }

      points = points.join(' ');

      let borderWidth = data.borderStyle.width;
      let polyline = this.svgFactory.createElement(this.svgElementName);
      polyline.setAttribute('points', points);
      polyline.setAttribute('stroke-width', borderWidth);
      polyline.setAttribute('stroke', 'transparent');
      polyline.setAttribute('fill', 'none');

      // Create the popup ourselves so that we can bind it to the polyline
      // instead of to the entire container (which is the default).
      this._createPopup(this.container, polyline, data);

      svg.appendChild(polyline);
    }

    this.container.append(svg);

    return this.container;
  }
}

class HighlightAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the highlight annotation's HTML element in the empty container.
   *
   * @public
   * @memberof HighlightAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'highlightAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class UnderlineAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the underline annotation's HTML element in the empty container.
   *
   * @public
   * @memberof UnderlineAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'underlineAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class SquigglyAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the squiggly annotation's HTML element in the empty container.
   *
   * @public
   * @memberof SquigglyAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'squigglyAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class StrikeOutAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the strikeout annotation's HTML element in the empty container.
   *
   * @public
   * @memberof StrikeOutAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'strikeoutAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class StampAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    let isRenderable = !!(parameters.data.hasPopup ||
                          parameters.data.title || parameters.data.contents);
    super(parameters, isRenderable, /* ignoreBorder = */ true);
  }

  /**
   * Render the stamp annotation's HTML element in the empty container.
   *
   * @public
   * @memberof StampAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'stampAnnotation';

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class FileAttachmentAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    super(parameters, /* isRenderable = */ true);

    const { filename, content, } = this.data.file;
    this.filename = getFilenameFromUrl(filename);
    this.content = content;

    if (this.linkService.eventBus) {
      this.linkService.eventBus.dispatch('fileattachmentannotation', {
        source: this,
        id: stringToPDFString(filename),
        filename,
        content,
      });
    }
  }

  /**
   * Render the file attachment annotation's HTML element in the empty
   * container.
   *
   * @public
   * @memberof FileAttachmentAnnotationElement
   * @returns {HTMLSectionElement}
   */
  render() {
    this.container.className = 'fileAttachmentAnnotation';

    let trigger = document.createElement('div');
    trigger.style.height = this.container.style.height;
    trigger.style.width = this.container.style.width;
    trigger.addEventListener('dblclick', this._download.bind(this));

    if (!this.data.hasPopup && (this.data.title || this.data.contents)) {
      this._createPopup(this.container, trigger, this.data);
    }

    this.container.appendChild(trigger);
    return this.container;
  }

  /**
   * Download the file attachment associated with this annotation.
   *
   * @private
   * @memberof FileAttachmentAnnotationElement
   */
  _download() {
    if (!this.downloadManager) {
      warn('Download cannot be started due to unavailable download manager');
      return;
    }
    this.downloadManager.downloadData(this.content, this.filename, '');
  }
}

/**
 * @typedef {Object} AnnotationLayerParameters
 * @property {PageViewport} viewport
 * @property {HTMLDivElement} div
 * @property {Array} annotations
 * @property {PDFPage} page
 * @property {IPDFLinkService} linkService
 * @property {DownloadManager} downloadManager
 * @property {string} imageResourcesPath - (optional) Path for image resources,
 *   mainly for annotation icons. Include trailing slash.
 * @property {boolean} renderInteractiveForms
 */

class AnnotationLayer {
  /**
   * Render a new annotation layer with all annotation elements.
   *
   * @public
   * @param {AnnotationLayerParameters} parameters
   * @memberof AnnotationLayer
   */
  static render(parameters) {
    for (let i = 0, ii = parameters.annotations.length; i < ii; i++) {
      let data = parameters.annotations[i];
      if (!data) {
        continue;
      }

      let element = AnnotationElementFactory.create({
        data,
        layer: parameters.div,
        page: parameters.page,
        viewport: parameters.viewport,
        linkService: parameters.linkService,
        downloadManager: parameters.downloadManager,
        imageResourcesPath: parameters.imageResourcesPath || '',
        renderInteractiveForms: parameters.renderInteractiveForms || false,
        svgFactory: new DOMSVGFactory(),
      });
      if (element.isRenderable) {
        parameters.div.appendChild(element.render());
      }
    }
  }

  /**
   * Update the annotation elements on existing annotation layer.
   *
   * @public
   * @param {AnnotationLayerParameters} parameters
   * @memberof AnnotationLayer
   */
  static update(parameters) {
    for (let i = 0, ii = parameters.annotations.length; i < ii; i++) {
      let data = parameters.annotations[i];
      let element = parameters.div.querySelector(
        '[data-annotation-id="' + data.id + '"]');
      if (element) {
        let scale = parseFloat(element.getAttribute('scale'));
        let scaleX = parameters.viewport.transform[0];
        let scaleY = parameters.viewport.transform[3];

        element.style.left = (parseFloat(element.style.left) / scale) *
          scaleX + 'px';
        element.style.top = (parseFloat(element.style.top) / scale) *
          scaleY + 'px';

        element.style.width = (parseFloat(element.style.width) / scale) *
          scaleX + 'px';
        element.style.height = (parseFloat(element.style.height) / scale) *
          scaleY + 'px';

        element.setAttribute('scale', scaleX);

        element.querySelectorAll('*').forEach((e) => {
          if (e.style.fontSize) {
            e.style.fontSize = parseFloat(e.style.fontSize) / scale * scaleX +
              'px';
          }

          if (e.style.width) {
            e.style.width = parseFloat(e.style.width) / scale * scaleX +
            'px';
          }

          if (e.style.height) {
            e.style.height = parseFloat(e.style.height) / scale * scaleX +
            'px';
          }

          if (e.style.lineHeight) {
            e.style.lineHeight = element.style.height;
          }
        });
      }
    }

    parameters.div.removeAttribute('hidden');
  }
}

export {
  AnnotationLayer,
};
