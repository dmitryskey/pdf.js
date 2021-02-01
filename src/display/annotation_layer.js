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
/* eslint no-var: error */

import {
  addLinkAttributes,
  DOMSVGFactory,
  getFilenameFromUrl,
  LinkTarget,
  PDFDateString,
} from "./display_utils.js";
import {
  AnnotationBorderStyleType,
  AnnotationCheckboxType,
  AnnotationType,
  stringToPDFString,
  unreachable,
  Util,
  warn,
} from "../shared/util.js";
import { AnnotationStorage } from "./annotation_storage.js";

/**
 * @typedef {Object} AnnotationElementParameters
 * @property {Object} data
 * @property {HTMLDivElement} layer
 * @property {PDFPage} page
 * @property {PageViewport} viewport
 * @property {IPDFLinkService} linkService
 * @property {DownloadManager} downloadManager
 * @property {AnnotationStorage} [annotationStorage]
 * @property {string} [imageResourcesPath] - Path for image resources, mainly
 *   for annotation icons. Include trailing slash.
 * @property {boolean} renderInteractiveForms
 * @property {Object} svgFactory
 */

class AnnotationElementFactory {
  /**
   * @param {AnnotationElementParameters} parameters
   * @returns {AnnotationElement}
   */
  static create(parameters) {
    const subtype = parameters.data.annotationType;

    switch (subtype) {
      case AnnotationType.LINK:
        return new LinkAnnotationElement(parameters);

      case AnnotationType.TEXT:
        return new TextAnnotationElement(parameters);

      case AnnotationType.WIDGET:
        const fieldType = parameters.data.fieldType;

        switch (fieldType) {
          case "Tx":
            return new TextWidgetAnnotationElement(parameters);
          case "Btn":
            if (parameters.data.radioButton) {
              return new RadioButtonWidgetAnnotationElement(parameters);
            } else if (parameters.data.checkBox) {
              return new CheckboxWidgetAnnotationElement(parameters);
            }
            return new PushButtonWidgetAnnotationElement(parameters);
          case "Ch":
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
    this.annotationStorage = parameters.annotationStorage;

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
    const data = this.data,
      page = this.page,
      viewport = this.viewport;
    const container = document.createElement("section");
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];

    container.setAttribute("data-annotation-id", data.id);

    // Do *not* modify `data.rect`, since that will corrupt the annotation
    // position on subsequent calls to `_createContainer` (see issue 6804).
    const rect = Util.normalizeRect([
      data.rect[0],
      page.view[3] - data.rect[1] + page.view[1],
      data.rect[2],
      page.view[3] - data.rect[3] + page.view[1],
    ]);

    container.style.transform = `matrix(${viewport.transform.join(",")})`;
    container.style.transformOrigin = `${-rect[0]}px ${-rect[1]}px`;

    if (!ignoreBorder && data.borderStyle.width > 0 && data.borderColor) {
      container.style.borderWidth = `${data.borderStyle.width}px`;
      if (data.borderStyle.style !== AnnotationBorderStyleType.UNDERLINE) {
        // Underline styles only have a bottom border, so we do not need
        // to adjust for all borders. This yields a similar result as
        // Adobe Acrobat/Reader.
        width = width - 2 * data.borderStyle.width;
        height = height - 2 * data.borderStyle.width;
      }

      const horizontalRadius = data.borderStyle.horizontalCornerRadius;
      const verticalRadius = data.borderStyle.verticalCornerRadius;
      if (horizontalRadius > 0 || verticalRadius > 0) {
        const radius = `${horizontalRadius}px / ${verticalRadius}px`;
        container.style.borderRadius = radius;
      }

      switch (data.borderStyle.style) {
        case AnnotationBorderStyleType.SOLID:
        case AnnotationBorderStyleType.INSET:
        case AnnotationBorderStyleType.BEVELED:
          // border styles 'inset' and 'beveled' are applied
          // to the underlying control
          container.style.borderStyle = "solid";
          break;

        case AnnotationBorderStyleType.DASHED:
          container.style.borderStyle = "dashed";
          break;

        case AnnotationBorderStyleType.UNDERLINE:
          container.style.borderBottomStyle = "solid";
          break;

        default:
          break;
      }

      if (data.borderColor) {
        container.style.borderColor = Util.makeCssRgb(
          data.borderColor[0] | 0,
          data.borderColor[1] | 0,
          data.borderColor[2] | 0
        );
      } else if (data.color) {
        container.style.borderColor = Util.makeCssRgb(
          data.color[0] | 0,
          data.color[1] | 0,
          data.color[2] | 0
        );
      } else {
        // Transparent (invisible) border, so do not draw it at all.
        container.style.borderWidth = 0;
      }
    }

    container.style.left = `${rect[0]}px`;
    container.style.top = `${rect[1]}px`;
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
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
      trigger = document.createElement("div");
      trigger.style.height = container.style.height;
      trigger.style.width = container.style.width;
      container.appendChild(trigger);
    }

    const popupElement = new PopupElement({
      container,
      trigger,
      color: data.color,
      title: data.title,
      modificationDate: data.modificationDate,
      contents: data.contents,
      hideWrapper: true,
    });
    const popup = popupElement.render();

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
    unreachable("Abstract method `AnnotationElement.render` called");
  }
}

class LinkAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.url ||
      parameters.data.dest ||
      parameters.data.action
    );
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
    this.container.className = "linkAnnotation";

    const { data, linkService } = this;
    const link = document.createElement("a");

    if (data.url) {
      addLinkAttributes(link, {
        url: data.url,
        target: data.newWindow
          ? LinkTarget.BLANK
          : linkService.externalLinkTarget,
        rel: linkService.externalLinkRel,
        enabled: linkService.externalLinkEnabled,
      });
    } else if (data.action) {
      this._bindNamedAction(link, data.action);
    } else {
      this._bindLink(link, data.dest);
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
      link.className = "internalLink";
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
    link.href = this.linkService.getAnchorUrl("");
    link.onclick = () => {
      this.linkService.executeNamedAction(action);
      return false;
    };
    link.className = "internalLink";
  }
}

class TextAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "textAnnotation";

    const image = document.createElement("img");
    image.style.height = this.container.style.height;
    image.style.width = this.container.style.width;
    image.src =
      this.imageResourcesPath +
      "annotation-" +
      this.data.name.toLowerCase() +
      ".svg";
    image.alt = "[{{type}} Annotation]";
    image.dataset.l10nId = "text_annotation_type";
    image.dataset.l10nArgs = JSON.stringify({ type: this.data.name });

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
      const bgColor = Util.makeCssRgb(color[0] | 0, color[1] | 0, color[2] | 0);

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
    return "Helvetica, sans-serif";
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
    const canvas = document.createElement("canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
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
    this.layer
      .querySelectorAll(
        '[annotation-name="' +
          `${annotation.getAttribute("annotation-name")}"][annotation-value="` +
          `${annotation.getAttribute("annotation-value")}"]`
      )
      .forEach(a => {
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
    const style = element.style;
    const maxHeight = parseInt(element.offsetHeight);
    offset = offset || 0;

    let fSize = 2;
    const sizeStep = 0.1;
    for (fSize = 2; fSize < maxHeight * 0.8; fSize += sizeStep) {
      const m = this._measureText(
        text,
        `${style.fontStyle ? style.fontStyle + " " : ""}` +
          `${style.fontWeight ? style.fontWeight + " " : ""}` +
          `${fSize}px ${this.fontFamily || this._getDefaultFontName()}`
      );

      if (m.width + offset > parseInt(element.offsetWidth)) {
        break;
      }
    }

    return `${fSize - sizeStep}px`;
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
        return "check";
      case AnnotationCheckboxType.CIRCLE:
        return "circle";
      case AnnotationCheckboxType.CROSS:
        return "cross";
      case AnnotationCheckboxType.DIAMOND:
        return "diamond";
      case AnnotationCheckboxType.SQUARE:
        return "square";
      case AnnotationCheckboxType.STAR:
        return "star";
      default:
        return "";
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
    const checkMarkSymbols = [];
    checkMarkSymbols[AnnotationCheckboxType.CHECK] = "✓";
    checkMarkSymbols[AnnotationCheckboxType.CIRCLE] = "●";
    checkMarkSymbols[AnnotationCheckboxType.CROSS] = "✕";
    checkMarkSymbols[AnnotationCheckboxType.DIAMOND] = "◆";
    checkMarkSymbols[AnnotationCheckboxType.SQUARE] = "■";
    checkMarkSymbols[AnnotationCheckboxType.STAR] = "★";
    return checkMarkSymbols;
  }
}

class TextWidgetAnnotationElement extends WidgetAnnotationElement {
  constructor(parameters) {
    const isRenderable =
      parameters.renderInteractiveForms ||
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
    const TEXT_ALIGNMENT = ["left", "center", "right"];
    const storage = this.annotationStorage;
    const id = this.data.id;

    this.container.className = "textWidgetAnnotation";

    if (!this.data.readOnly) {
      this.container.title = this.data.alternativeText;
    }

    let element = null;
    let font = null;
    if (this.renderInteractiveForms) {
      // NOTE: We cannot set the values using `element.value` below, since it
      //       prevents the AnnotationLayer rasterizer in `test/driver.js`
      //       from parsing the elements correctly for the reference tests.
      const textContent = storage.getOrCreateValue(id, this.data.fieldValue);

      if (this.data.multiLine) {
        element = document.createElement("textarea");
        element.textContent = textContent;
      } else {
        element = document.createElement("input");
        element.type = "text";
        element.setAttribute("value", textContent);
      }

      element.setAttribute(
        "annotation-name",
        encodeURIComponent(this.data.fieldName)
      );
      element.addEventListener("input", function (event) {
        storage.setValue(id, event.target.value);
      });

      element.disabled = this.data.readOnly;
      element.name = this.data.fieldName;

      if (this.data.required) {
        element.setAttribute("annotation-required", true);
      }

      if (this.data.maxLen !== null) {
        element.maxLength = this.data.maxLen;
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
        element.className = "inset";
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
        element.className = "beveled";
      }

      if (this.data.comb) {
        const fieldWidth = this.data.rect[2] - this.data.rect[0];
        const combWidth = fieldWidth / this.data.maxLen;

        element.classList.add("comb");
        element.style.letterSpacing = `calc(${combWidth}px - 1ch)`;
      }

      for (const f of this.data.annotationFonts) {
        if (
          f.length >= 3 &&
          this.data.fontRefName &&
          f[0] === this.data.fontRefName
        ) {
          font = f[2];
          break;
        }
      }
    } else {
      element = document.createElement("div");
      element.textContent = this.data.fieldValue;
      element.style.verticalAlign = "middle";
      element.style.display = "table-cell";

      if (
        this.data.fontRefName &&
        this.page.commonObjs.has(this.data.fontRefName)
      ) {
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
    const style = element.style;

    if (this.data.fontColor) {
      style.color = this.data.fontColor;
    }

    if (this.data.fontSize) {
      style.fontSize = `${this.data.fontSize}px`;
    }

    if (this.data.fontDirection) {
      style.direction = this.data.fontDirection < 0 ? "rtl" : "ltr";
    }

    if (font) {
      let bold = "normal";
      if (font.black) {
        bold = "900";
      } else if (font.bold) {
        bold = "bold";
      }
      style.fontWeight = bold;
      style.fontStyle = font.italic ? "italic" : "normal";

      // Use a reasonable default font if the font doesn't specify a fallback.
      const fontFamily = font.loadedName ? `"${font.loadedName}", ` : "";
      const fallbackName = font.fallbackName || this._getDefaultFontName();
      style.fontFamily = fontFamily + fallbackName;
    }

    const self = this;

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
      window.setTimeout(
        () => {
          element.style.fontSize = self._calculateFontAutoSize(
            element,
            element.value
          );
        },
        100,
        element,
        this
      );

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
    const storage = this.annotationStorage;
    const data = this.data;
    const id = data.id;
    const value = storage.getOrCreateValue(
      id,
      data.fieldValue && data.fieldValue !== "Off"
    );

    this.container.className = "buttonWidgetAnnotation checkBox ";

    if (!data.readOnly) {
      this.container.title = data.alternativeText;
    }

    const element = document.createElement("input");
    element.setAttribute("annotation-name", encodeURIComponent(data.fieldName));
    element.setAttribute(
      "annotation-value",
      data.buttonValue ? encodeURIComponent(data.buttonValue) : ""
    );
    element.disabled = data.readOnly;
    element.type = "checkbox";
    element.name = data.fieldName;
    if (value) {
      element.setAttribute("checked", true);
    }
    element.checkBoxType = data.checkBoxType;

    if (data.borderStyle.style === AnnotationBorderStyleType.INSET) {
      element.className = "inset";
    }

    if (data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
      element.className = "beveled";
    }

    element.addEventListener("change", function (event) {
      storage.setValue(id, event.target.checked);
    });

    this.container.appendChild(element);

    // We have to create a div with checkbox symbol
    // in order to deal with background color, when
    // div with text handles onclick event.
    const span = document.createElement("span");

    const checkMarkSymbols = this._getCheckmarkSymbols();

    span.innerText = element.checked
      ? checkMarkSymbols[element.checkBoxType]
      : "";

    const self = this;

    element.onchange = () => {
      span.innerText = element.checked
        ? checkMarkSymbols[element.checkBoxType]
        : "";

      self._processDuplicates(element, (a, b) => {
        if (b.parentElement) {
          b.checked = a.checked;

          const annotationSpans = b.parentElement.getElementsByTagName("span");

          if (annotationSpans.length > 0) {
            annotationSpans[0].innerText = a.checked
              ? checkMarkSymbols[b.checkBoxType]
              : "";
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

    let fontSizeFactor = 1.0;

    if (
      this.data.checkBoxType === AnnotationCheckboxType.CIRCLE ||
      this.data.checkBoxType === AnnotationCheckboxType.DIAMOND ||
      this.data.checkBoxType === AnnotationCheckboxType.SQUARE
    ) {
      fontSizeFactor = 1.5;
    }

    if (this.data.checkBoxType === AnnotationCheckboxType.STAR) {
      fontSizeFactor = 0.5;
    }

    const fontSizePadding =
      this.data.checkBoxType !== AnnotationCheckboxType.STAR &&
      (this.data.borderStyle.style === AnnotationBorderStyleType.INSET ||
        this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED)
        ? 4
        : 0;

    span.style.lineHeight = this.container.style.height;

    span.style.fontSize = `${
      parseFloat(this.container.style.height) * fontSizeFactor - fontSizePadding
    }px`;

    span.style.color = this.data.fontColor;
    this.container.className += this._getCheckBoxStyle(this.data.checkBoxType);

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
    this.container.className = "buttonWidgetAnnotation radioButton ";
    const storage = this.annotationStorage;
    const data = this.data;
    const id = data.id;
    const value = storage.getOrCreateValue(
      id,
      data.fieldValue === data.buttonValue
    );

    if (!data.readOnly) {
      this.container.title = data.alternativeText;
    }

    const element = document.createElement("input");
    element.disabled = data.readOnly;
    element.name = encodeURIComponent(this.data.fieldName);
    element.setAttribute(
      "annotation-name",
      encodeURIComponent(`${data.fieldName}_${data.buttonValue || ""}`)
    );
    element.disabled = data.readOnly;
    element.type = "radio";
    element.name = data.fieldName;
    if (value) {
      element.setAttribute("checked", true);
    }

    element.radioButtonType = data.radioButtonType;

    if (data.radioButtonType === AnnotationCheckboxType.CIRCLE) {
      element.style.width = this.container.style.width = this.container.style.height;
      this.container.borderRadius = "50%";
    }

    if (data.borderStyle.style === AnnotationBorderStyleType.INSET) {
      element.className = "inset";
    }

    if (data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
      element.className = "beveled";
    }

    element.addEventListener("change", function (event) {
      const name = event.target.name;
      for (const radio of document.getElementsByName(name)) {
        if (radio !== event.target) {
          storage.setValue(
            radio.parentNode.getAttribute("data-annotation-id"),
            false
          );
        }
      }
      storage.setValue(id, event.target.checked);
    });

    this.container.appendChild(element);

    const span = document.createElement("span");

    const checkMarkSymbols = this._getCheckmarkSymbols();

    span.innerText = element.checked
      ? checkMarkSymbols[element.radioButtonType]
      : "";

    element.onchange = () => {
      span.innerText = checkMarkSymbols[element.radioButtonType];

      const annotations = document.getElementsByName(element.name);
      for (const index in annotations) {
        if (
          annotations[index] !== element &&
          annotations[index].parentElement
        ) {
          const annotationSpans = annotations[
            index
          ].parentElement.getElementsByTagName("span");
          if (annotationSpans.length > 0) {
            annotationSpans[0].innerHTML = "";
          }
        }
      }
    };

    let fontSizeFactor = 1.0;

    if (
      this.data.checkBoxType === AnnotationCheckboxType.CIRCLE ||
      this.data.checkBoxType === AnnotationCheckboxType.DIAMOND ||
      this.data.checkBoxType === AnnotationCheckboxType.SQUARE
    ) {
      fontSizeFactor = 1.5;
    }

    if (this.data.checkBoxType === AnnotationCheckboxType.STAR) {
      fontSizeFactor = 0.5;
    }

    const fontSizePadding =
      this.data.radioButtonType !== AnnotationCheckboxType.STAR &&
      (this.data.borderStyle.style === AnnotationBorderStyleType.INSET ||
        this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED)
        ? 4
        : 0;

    span.style.lineHeight = this.container.style.height;

    span.style.fontSize = `${
      parseFloat(this.container.style.height) * fontSizeFactor - fontSizePadding
    }px`;

    span.style.color = this.data.fontColor;
    this.container.className += this._getCheckBoxStyle(
      this.data.radioButtonType
    );

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
    const container = super.render();
    container.className = "buttonWidgetAnnotation pushButton";
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
    this.container.className = "choiceWidgetAnnotation";
    const storage = this.annotationStorage;
    const id = this.data.id;

    let style;
    const itemName = encodeURIComponent(this.data.fieldName) + "_item";

    const self = this;

    // For printing/saving we currently only support choice widgets with one
    // option selection. Therefore, listboxes (#12189) and comboboxes (#12224)
    // are not properly printed/saved yet, so we only store the first item in
    // the field value array instead of the entire array. Once support for those
    // two field types is implemented, we should use the same pattern as the
    // other interactive widgets where the return value of `getOrCreateValue` is
    // used and the full array of field values is stored.
    storage.getOrCreateValue(
      id,
      this.data.fieldValue.length > 0 ? this.data.fieldValue[0] : null
    );

    if (!this.data.combo) {
      const selectElement = document.createElement("select");
      selectElement.disabled = this.data.readOnly;
      selectElement.name = itemName;

      selectElement.setAttribute(
        "annotation-name",
        encodeURIComponent(this.data.fieldName)
      );

      if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
        selectElement.className = "inset";
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
        selectElement.className = "beveled";
      }

      style = selectElement.style;

      this._setElementFont(selectElement);

      this._setBackgroundColor(selectElement, this.data.backgroundColor);

      // List boxes have a size and (optionally) multiple selection.
      selectElement.size = this.data.options.length;
      if (this.data.multiSelect) {
        selectElement.setAtttibute("multiple", true);
      }

      // Insert the options into the choice field.
      for (const option of this.data.options) {
        const optionElement = document.createElement("option");
        optionElement.textContent = option.displayValue;
        optionElement.value = option.exportValue;
        if (this.data.fieldValue.includes(option.displayValue)) {
          optionElement.setAttribute("selected", true);
        }
        selectElement.appendChild(optionElement);
      }

      selectElement.onblur = () => {
        self._processDuplicates(selectElement, (a, b) => {
          for (let i = 0; i < a.options.length; i++) {
            if (i < b.options.length) {
              b.options[i].setAttribute(
                "selected",
                a.options[i].getAttribute("selected")
              );
            }
          }
        });
      };

      selectElement.addEventListener("input", function (event) {
        const options = event.target.options;
        const value = options[options.selectedIndex].text;
        storage.setValue(id, value);
      });

      this.container.appendChild(selectElement);
    } else {
      const hoverClass = "hover";
      const showClass = "show";

      const comboElementDiv = document.createElement("div");
      comboElementDiv.className = "combo";
      comboElementDiv.style.height = this.container.style.height;

      const comboElement = document.createElement("input");
      comboElement.type = "text";
      comboElement.readOnly = !this.data.customText;
      comboElement.setAttribute(
        "annotation-name",
        encodeURIComponent(this.data.fieldName)
      );
      comboElement.style.height = this.container.style.height;
      comboElement.style.width = this.container.style.width;

      if (this.data.borderStyle.style === AnnotationBorderStyleType.INSET) {
        comboElement.className = "inset";
      }

      if (this.data.borderStyle.style === AnnotationBorderStyleType.BEVELED) {
        comboElement.className = "beveled";
      }

      style = comboElement.style;

      const downArrowWidth = self._measureText(
        "▼",
        `8pt ${self._getDefaultFontName()}`
      ).width;

      this._setElementFont(comboElement);

      this._setBackgroundColor(comboElement, this.data.backgroundColor);

      const comboContent = document.createElement("div");
      comboContent.className = "combo-content";

      this._setElementFont(comboContent);

      comboContent.onmouseover = () => {
        comboElement.selected = true;
      };

      comboContent.onmouseout = () => {
        comboElement.selected = false;
      };

      comboElement.onkeypress = event => {
        if (event.key === "Enter") {
          comboContent.classList.toggle(showClass);
          return;
        }

        const filterChar = event.key.toUpperCase();

        const items = comboContent.getElementsByTagName("a");
        let selectedIndex = -1;
        let firstIndex = -1;
        let lastIndex = -1;
        let newIndex = -1;

        for (let i = 0; i < items.length; i++) {
          if (
            items[i].classList.contains(hoverClass) &&
            items[i].text[0].toUpperCase() === filterChar
          ) {
            selectedIndex = i;
          }

          if (
            items[i].text &&
            items[i].text.length > 0 &&
            items[i].text[0].toUpperCase() === filterChar
          ) {
            if (firstIndex < 0) {
              firstIndex = i;
            }

            lastIndex = i;
          }

          items[i].classList.remove(hoverClass);
        }

        for (let i = 0; i < items.length; i++) {
          if (
            items[i].text &&
            items[i].text.length > 0 &&
            items[i].text[0].toUpperCase() === filterChar &&
            i > selectedIndex
          ) {
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

          const hRatio = comboContent.clientHeight / comboContent.scrollHeight;
          const pRatio = (selectedItemIndex + 1) / items.length;

          if (hRatio <= pRatio) {
            comboContent.scrollTop =
              (selectedItemIndex / items.length) * comboContent.scrollHeight;
          } else {
            comboContent.scrollTop = 0;
          }

          // Auto size
          if (comboElement.autoSize) {
            style.fontSize = self._calculateFontAutoSize(
              comboElement,
              selectedItem.text,
              downArrowWidth
            );
          }
        }
      };

      comboElement.onblur = () => {
        if (!comboElement.selected) {
          comboContent.classList.remove(showClass);
          self.container.style.position = "";
          self.container.style.zIndex = "";
        }

        self._processDuplicates(comboElement, (a, b) => {
          b.value = a.value;
        });
      };

      const spanElement = document.createElement("span");
      spanElement.onclick = () => {
        if (!comboElement.disabled) {
          comboElement.focus();
          comboContent.classList.toggle(showClass);
          self.container.style.position = "absolute";
          self.container.style.zIndex = "100";
        }
      };

      let comboWidth = parseFloat(self.container.style.width);
      let increaseComboWidth = false;

      const aElementPadding = 2;

      for (const optionItem of this.data.options) {
        if (this.data.fieldValue.includes(optionItem.exportValue)) {
          comboElement.value = optionItem.displayValue;
        }

        const aElement = document.createElement("a");
        aElement.setAttribute("value", optionItem.exportValue);
        aElement.text = optionItem.displayValue;
        aElement.style.padding = `${aElementPadding}px`;
        aElement.style.fontSize = `${style.fontSize ? style.fontSize : 9}px`;

        const aElementWidth = self._measureText(
          aElement.text,
          `${style.fontStyle ? style.fontStyle + " " : ""}
           ${style.fontWeight ? style.fontWeight + " " : ""}
           ${style.fontSize ? style.fontSize : "9"}px 
           ${style.fontFamily || self._getDefaultFontName()}`
        );

        if (
          aElementWidth.width + downArrowWidth + aElementPadding * 2 >
          comboWidth
        ) {
          comboWidth = aElementWidth.width;
          increaseComboWidth = true;
        }

        aElement.onclick = () => {
          storage.setValue(id, aElement.text);
          comboElement.value = aElement.text;
          comboContent.classList.remove(showClass);
          self.container.style.position = "";
          self.container.style.zIndex = "";

          // Auto size
          if (comboElement.autoSize) {
            style.fontSize = self._calculateFontAutoSize(
              comboElement,
              aElement.text,
              downArrowWidth
            );
          }
        };

        aElement.onmouseover = () => {
          for (const item of comboContent.getElementsByTagName("a")) {
            item.classList.remove(hoverClass);
          }

          aElement.classList.add(hoverClass);
        };

        aElement.onmouseout = () => {
          aElement.classList.remove(hoverClass);
        };

        comboContent.appendChild(aElement);
      }

      if (increaseComboWidth) {
        comboContent.style.width = `${
          comboWidth + downArrowWidth + aElementPadding * 2
        }px`;
      }

      if (!style.fontSize) {
        comboElement.autoSize = true;

        window.setTimeout(
          element => {
            element.style.fontSize = self._calculateFontAutoSize(
              element,
              element.value,
              downArrowWidth
            );
          },
          100,
          comboElement,
          this,
          downArrowWidth
        );
      }

      comboElementDiv.appendChild(comboElement);

      if (!this.data.readOnly) {
        comboElementDiv.appendChild(spanElement);
        comboElementDiv.appendChild(comboContent);
      }

      this.container.appendChild(comboElementDiv);
    }

    let styleExpression = "";

    if (this.data.backgroundColor) {
      const bgColor = Util.makeCssRgb(
        this.data.backgroundColor[0] | 0,
        this.data.backgroundColor[1] | 0,
        this.data.backgroundColor[2] | 0
      );

      styleExpression = `background-color:${bgColor};`;
    }

    styleExpression += `${style.color ? "color:" + style.color + ";" : ""}
       ${style.fontSize ? "font-size:" + style.fontSize + ";" : ""}
       ${style.fontWeight ? "font-weight:" + style.fontWeight + ";" : ""}
       ${style.fontStyle ? "font-style:" + style.fontStyle + ";" : ""}
       ${style.fontFamily ? "font-family:" + style.fontFamily + ";" : ""}`;

    const cssClass = document.createElement("style");
    cssClass.innerText = `.${this.layer.className} .${this.container.className} 
      [name='${itemName}']{${styleExpression}}`;

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
    const style = element.style;

    if (this.data.fontColor) {
      style.color = this.data.fontColor;
    }

    if (this.data.fontSize) {
      style.fontSize = `${this.data.fontSize}px`;
    }

    if (this.data.fontRefName) {
      for (const f of this.data.annotationFonts) {
        if (f.length >= 3 && f[0] === this.data.fontRefName) {
          const font = f[2];

          let bold = "normal";
          if (font.black) {
            bold = "900";
          } else if (font.bold) {
            bold = "bold";
          }
          style.fontWeight = bold;
          style.fontStyle = font.italic ? "italic" : "normal";
          const fontFamily = font.loadedName ? `"${font.loadedName}", ` : "";
          const fallbackName = font.fallbackName || this._getDefaultFontName();
          style.fontFamily = fontFamily + fallbackName;
          break;
        }
      }
    }
  }
}

class PopupAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(parameters.data.title || parameters.data.contents);
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
      "Line",
      "Square",
      "Circle",
      "PolyLine",
      "Polygon",
      "Ink",
    ];

    this.container.className = "popupAnnotation";

    if (IGNORE_TYPES.includes(this.data.parentType)) {
      return this.container;
    }

    const selector = `[data-annotation-id="${this.data.parentId}"]`;
    const parentElement = this.layer.querySelector(selector);
    if (!parentElement) {
      return this.container;
    }

    const popup = new PopupElement({
      container: this.container,
      trigger: parentElement,
      color: this.data.color,
      title: this.data.title,
      modificationDate: this.data.modificationDate,
      contents: this.data.contents,
    });

    // Position the popup next to the parent annotation's container.
    // PDF viewers ignore a popup annotation's rectangle.
    const parentTop = parseFloat(parentElement.style.top),
      parentLeft = parseFloat(parentElement.style.left),
      parentWidth = parseFloat(parentElement.style.width);
    const popupLeft = parentLeft + parentWidth;

    this.container.style.transformOrigin = `${-popupLeft}px ${-parentTop}px`;
    this.container.style.left = `${popupLeft}px`;

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

    const wrapper = document.createElement("div");
    wrapper.className = "popupWrapper";

    // For Popup annotations we hide the entire section because it contains
    // only the popup. However, for Text annotations without a separate Popup
    // annotation, we cannot hide the entire container as the image would
    // disappear too. In that special case, hiding the wrapper suffices.
    this.hideElement = this.hideWrapper ? wrapper : this.container;
    this.hideElement.setAttribute("hidden", true);

    const popup = document.createElement("div");
    popup.className = "popup";

    const color = this.color;
    if (color) {
      // Enlighten the color.
      const r = BACKGROUND_ENLIGHT * (255 - color[0]) + color[0];
      const g = BACKGROUND_ENLIGHT * (255 - color[1]) + color[1];
      const b = BACKGROUND_ENLIGHT * (255 - color[2]) + color[2];
      popup.style.backgroundColor = Util.makeCssRgb(r | 0, g | 0, b | 0);
    }

    const title = document.createElement("h1");
    title.textContent = this.title;
    popup.appendChild(title);

    // The modification date is shown in the popup instead of the creation
    // date if it is available and can be parsed correctly, which is
    // consistent with other viewers such as Adobe Acrobat.
    const dateObject = PDFDateString.toDateObject(this.modificationDate);
    if (dateObject) {
      const modificationDate = document.createElement("span");
      modificationDate.textContent = "{{date}}, {{time}}";
      modificationDate.dataset.l10nId = "annotation_date_string";
      modificationDate.dataset.l10nArgs = JSON.stringify({
        date: dateObject.toLocaleDateString(),
        time: dateObject.toLocaleTimeString(),
      });
      popup.appendChild(modificationDate);
    }

    const contents = this._formatContents(this.contents);
    popup.appendChild(contents);

    // Attach the event listeners to the trigger element.
    this.trigger.addEventListener("click", this._toggle.bind(this));
    this.trigger.addEventListener("mouseover", this._show.bind(this, false));
    this.trigger.addEventListener("mouseout", this._hide.bind(this, false));
    popup.addEventListener("click", this._hide.bind(this, true));

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
    const p = document.createElement("p");
    const lines = contents.split(/(?:\r\n?|\n)/);
    for (let i = 0, ii = lines.length; i < ii; ++i) {
      const line = lines[i];
      p.appendChild(document.createTextNode(line));
      if (i < ii - 1) {
        p.appendChild(document.createElement("br"));
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
    if (this.hideElement.hasAttribute("hidden")) {
      this.hideElement.removeAttribute("hidden");
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
    if (!this.hideElement.hasAttribute("hidden") && !this.pinned) {
      this.hideElement.setAttribute("hidden", true);
      this.container.style.zIndex -= 1;
    }
  }
}

class FreeTextAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "freeTextAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class LineAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "lineAnnotation";

    // Create an invisible line with the same starting and ending coordinates
    // that acts as the trigger for the popup. Only the line itself should
    // trigger the popup, not the entire container.
    const data = this.data;
    const width = data.rect[2] - data.rect[0];
    const height = data.rect[3] - data.rect[1];
    const svg = this.svgFactory.create(width, height);

    // PDF coordinates are calculated from a bottom left origin, so transform
    // the line coordinates to a top left origin for the SVG element.
    const line = this.svgFactory.createElement("svg:line");
    line.setAttribute("x1", data.rect[2] - data.lineCoordinates[0]);
    line.setAttribute("y1", data.rect[3] - data.lineCoordinates[1]);
    line.setAttribute("x2", data.rect[2] - data.lineCoordinates[2]);
    line.setAttribute("y2", data.rect[3] - data.lineCoordinates[3]);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    line.setAttribute("stroke-width", data.borderStyle.width || 1);
    line.setAttribute("stroke", "transparent");

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
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "squareAnnotation";

    // Create an invisible square with the same rectangle that acts as the
    // trigger for the popup. Only the square itself should trigger the
    // popup, not the entire container.
    const data = this.data;
    const width = data.rect[2] - data.rect[0];
    const height = data.rect[3] - data.rect[1];
    const svg = this.svgFactory.create(width, height);

    // The browser draws half of the borders inside the square and half of
    // the borders outside the square by default. This behavior cannot be
    // changed programmatically, so correct for that here.
    const borderWidth = data.borderStyle.width;
    const square = this.svgFactory.createElement("svg:rect");
    square.setAttribute("x", borderWidth / 2);
    square.setAttribute("y", borderWidth / 2);
    square.setAttribute("width", width - borderWidth);
    square.setAttribute("height", height - borderWidth);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    square.setAttribute("stroke-width", borderWidth || 1);
    square.setAttribute("stroke", "transparent");
    square.setAttribute("fill", "none");

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
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "circleAnnotation";

    // Create an invisible circle with the same ellipse that acts as the
    // trigger for the popup. Only the circle itself should trigger the
    // popup, not the entire container.
    const data = this.data;
    const width = data.rect[2] - data.rect[0];
    const height = data.rect[3] - data.rect[1];
    const svg = this.svgFactory.create(width, height);

    // The browser draws half of the borders inside the circle and half of
    // the borders outside the circle by default. This behavior cannot be
    // changed programmatically, so correct for that here.
    const borderWidth = data.borderStyle.width;
    const circle = this.svgFactory.createElement("svg:ellipse");
    circle.setAttribute("cx", width / 2);
    circle.setAttribute("cy", height / 2);
    circle.setAttribute("rx", width / 2 - borderWidth / 2);
    circle.setAttribute("ry", height / 2 - borderWidth / 2);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    circle.setAttribute("stroke-width", borderWidth || 1);
    circle.setAttribute("stroke", "transparent");
    circle.setAttribute("fill", "none");

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
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
    super(parameters, isRenderable, /* ignoreBorder = */ true);

    this.containerClassName = "polylineAnnotation";
    this.svgElementName = "svg:polyline";
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
    const data = this.data;
    const width = data.rect[2] - data.rect[0];
    const height = data.rect[3] - data.rect[1];
    const svg = this.svgFactory.create(width, height);

    // Convert the vertices array to a single points string that the SVG
    // polyline element expects ("x1,y1 x2,y2 ..."). PDF coordinates are
    // calculated from a bottom left origin, so transform the polyline
    // coordinates to a top left origin for the SVG element.
    let points = [];
    for (const coordinate of data.vertices) {
      const x = coordinate.x - data.rect[0];
      const y = data.rect[3] - coordinate.y;
      points.push(x + "," + y);
    }
    points = points.join(" ");

    const polyline = this.svgFactory.createElement(this.svgElementName);
    polyline.setAttribute("points", points);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    polyline.setAttribute("stroke-width", data.borderStyle.width || 1);
    polyline.setAttribute("stroke", "transparent");
    polyline.setAttribute("fill", "none");

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

    this.containerClassName = "polygonAnnotation";
    this.svgElementName = "svg:polygon";
  }
}

class CaretAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "caretAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class InkAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
    super(parameters, isRenderable, /* ignoreBorder = */ true);

    this.containerClassName = "inkAnnotation";

    // Use the polyline SVG element since it allows us to use coordinates
    // directly and to draw both straight lines and curves.
    this.svgElementName = "svg:polyline";
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
    const data = this.data;
    const width = data.rect[2] - data.rect[0];
    const height = data.rect[3] - data.rect[1];
    const svg = this.svgFactory.create(width, height);

    for (const inkList of data.inkLists) {
      // Convert the ink list to a single points string that the SVG
      // polyline element expects ("x1,y1 x2,y2 ..."). PDF coordinates are
      // calculated from a bottom left origin, so transform the polyline
      // coordinates to a top left origin for the SVG element.
      let points = [];
      for (const coordinate of inkList) {
        const x = coordinate.x - data.rect[0];
        const y = data.rect[3] - coordinate.y;
        points.push(`${x},${y}`);
      }
      points = points.join(" ");

      const polyline = this.svgFactory.createElement(this.svgElementName);
      polyline.setAttribute("points", points);
      // Ensure that the 'stroke-width' is always non-zero, since otherwise it
      // won't be possible to open/close the popup (note e.g. issue 11122).
      polyline.setAttribute("stroke-width", data.borderStyle.width || 1);
      polyline.setAttribute("stroke", "transparent");
      polyline.setAttribute("fill", "none");

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
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "highlightAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class UnderlineAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "underlineAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class SquigglyAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "squigglyAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class StrikeOutAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "strikeoutAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class StampAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    const isRenderable = !!(
      parameters.data.hasPopup ||
      parameters.data.title ||
      parameters.data.contents
    );
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
    this.container.className = "stampAnnotation";

    if (!this.data.hasPopup) {
      this._createPopup(this.container, null, this.data);
    }
    return this.container;
  }
}

class FileAttachmentAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    super(parameters, /* isRenderable = */ true);

    const { filename, content } = this.data.file;
    this.filename = getFilenameFromUrl(filename);
    this.content = content;

    if (this.linkService.eventBus) {
      this.linkService.eventBus.dispatch("fileattachmentannotation", {
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
    this.container.className = "fileAttachmentAnnotation";

    const trigger = document.createElement("div");
    trigger.style.height = this.container.style.height;
    trigger.style.width = this.container.style.width;
    trigger.addEventListener("dblclick", this._download.bind(this));

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
      warn("Download cannot be started due to unavailable download manager");
      return;
    }
    this.downloadManager.downloadData(this.content, this.filename, "");
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
 * @property {string} [imageResourcesPath] - Path for image resources, mainly
 *   for annotation icons. Include trailing slash.
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
    const sortedAnnotations = [],
      popupAnnotations = [];
    // Ensure that Popup annotations are handled last, since they're dependant
    // upon the parent annotation having already been rendered (please refer to
    // the `PopupAnnotationElement.render` method); fixes issue 11362.
    for (const data of parameters.annotations) {
      if (!data) {
        continue;
      }
      if (data.annotationType === AnnotationType.POPUP) {
        popupAnnotations.push(data);
        continue;
      }
      sortedAnnotations.push(data);
    }
    if (popupAnnotations.length) {
      sortedAnnotations.push(...popupAnnotations);
    }

    for (const data of sortedAnnotations) {
      const element = AnnotationElementFactory.create({
        data,
        layer: parameters.div,
        page: parameters.page,
        viewport: parameters.viewport,
        linkService: parameters.linkService,
        downloadManager: parameters.downloadManager,
        imageResourcesPath: parameters.imageResourcesPath || "",
        renderInteractiveForms:
          typeof parameters.renderInteractiveForms === "boolean"
            ? parameters.renderInteractiveForms
            : true,
        svgFactory: new DOMSVGFactory(),
        annotationStorage:
          parameters.annotationStorage || new AnnotationStorage(),
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
    for (const data of parameters.annotations) {
      const element = parameters.div.querySelector(
        `[data-annotation-id="${data.id}"]`
      );
      if (element) {
        element.style.transform = `matrix(${parameters.viewport.transform.join(
          ","
        )})`;
      }
    }

    parameters.div.removeAttribute("hidden");
  }
}

export { AnnotationLayer };
