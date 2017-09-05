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
  addLinkAttributes, CustomStyle, getDefaultSetting, getFilenameFromUrl,
  LinkTarget
} from './dom_utils';
import {
  AnnotationBorderStyleType, AnnotationType, stringToPDFString, Util, warn
} from '../shared/util';

/**
 * @typedef {Object} AnnotationElementParameters
 * @property {Object} data
 * @property {HTMLDivElement} layer
 * @property {PDFPage} page
 * @property {PageViewport} viewport
 * @property {IPDFLinkService} linkService
 * @property {DownloadManager} downloadManager
 * @property {string} imageResourcesPath
 * @property {boolean} renderInteractiveForms
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
            warn('Unimplemented button widget annotation: pushbutton');
            break;
          case 'Ch':
            return new ChoiceWidgetAnnotationElement(parameters);
        }
        return new WidgetAnnotationElement(parameters);

      case AnnotationType.POPUP:
        return new PopupAnnotationElement(parameters);

      case AnnotationType.LINE:
        return new LineAnnotationElement(parameters);

      case AnnotationType.HIGHLIGHT:
        return new HighlightAnnotationElement(parameters);

      case AnnotationType.UNDERLINE:
        return new UnderlineAnnotationElement(parameters);

      case AnnotationType.SQUIGGLY:
        return new SquigglyAnnotationElement(parameters);

      case AnnotationType.STRIKEOUT:
        return new StrikeOutAnnotationElement(parameters);

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

    CustomStyle.setProp('transform', container,
                        'matrix(' + viewport.transform.join(',') + ')');
    CustomStyle.setProp('transformOrigin', container,
                        -rect[0] + 'px ' + -rect[1] + 'px');

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
        CustomStyle.setProp('borderRadius', container, radius);
      }

      switch (data.borderStyle.style) {
        case AnnotationBorderStyleType.SOLID:
          container.style.borderStyle = 'solid';
          break;

        case AnnotationBorderStyleType.DASHED:
          container.style.borderStyle = 'dashed';
          break;

        case AnnotationBorderStyleType.BEVELED:
          warn('Unimplemented border style: beveled');
          break;

        case AnnotationBorderStyleType.INSET:
          warn('Unimplemented border style: inset');
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

    container.style.left = rect[0] + 'px';
    container.style.top = rect[1] + 'px';

    container.style.width = width + 'px';
    container.style.height = height + 'px';

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
    throw new Error('Abstract method `AnnotationElement.render` called');
  }
}

class LinkAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    super(parameters, /* isRenderable = */ true);
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

    let link = document.createElement('a');
    addLinkAttributes(link, {
      url: this.data.url,
      target: (this.data.newWindow ? LinkTarget.BLANK : undefined),
    });

    if (!this.data.url) {
      if (this.data.action) {
        this._bindNamedAction(link, this.data.action);
      } else {
        this._bindLink(link, this.data.dest);
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
   * @param {String} annotation layer class name
   * @param {String} container class name
   * @memberof WidgetAnnotationElement
   */
  _setBackgroundColor(
        element, color, layerClassName, containerClassName) {
    if (color && layerClassName && containerClassName) {
      let bgColor = Util.makeCssRgb(
        color[0] | 0,
        color[1] | 0,
        color[2] | 0);

      let cssClass = document.createElement('style');
      cssClass.innerHTML =
        '.' + layerClassName + ' .' + containerClassName +
        ' [name="' + encodeURIComponent(element.name) +
        '"]:focus {background-color:' + bgColor + ';}';

      document.body.appendChild(cssClass);
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

      element.name = encodeURIComponent(this.data.fieldName);

      element.disabled = this.data.readOnly;

      if (this.data.maxLen !== null) {
        element.maxLength = this.data.maxLen;
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

      if (this.data.fontRefName) {
        font = this.page.commonObjs.getData(this.data.fontRefName);
      }
    }

    this._setTextStyle(element, font);

    if (this.data.textAlignment !== null) {
      element.style.textAlign = TEXT_ALIGNMENT[this.data.textAlignment];
    }

    this._setBackgroundColor(
      element,
      this.data.backgroundColor,
      this.layer.className,
      this.container.className);

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

    // Auto size
    if (!style.fontSize && !this.data.multiLine) {
      style.fontSize = '9px';
      let self = this;
      element.onblur = function() {
        let maxHeight = parseInt(self.container.style.height);

        let fSize = 2;
        for (fSize = 2; fSize < maxHeight - 2; fSize += 0.2) {
          let m = self._measureText(element.value,
            (style.fontStyle ? style.fontStyle + ' ' : '') +
            (style.fontWeight ? style.fontWeight + ' ' : '') +
            fSize + 'px ' +
            (style.fontFamily || self._getDefaultFontName()));

          if (m.width > parseInt(self.container.style.width)) {
            break;
          }
        }

        style.fontSize = --fSize + 'px';
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
    this.container.className = 'buttonWidgetAnnotation checkBox';

    let element = document.createElement('input');
    element.name = encodeURIComponent(this.data.fieldName);
    element.disabled = this.data.readOnly;
    element.type = 'checkbox';
    if (this.data.fieldValue && this.data.fieldValue !== 'Off') {
      element.setAttribute('checked', true);
    }

    this.container.style.fontSize = this.container.style.height;

    this.container.appendChild(element);
    this.container.appendChild(document.createElement('span'));

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
    this.container.className = 'buttonWidgetAnnotation radioButton';

    let element = document.createElement('input');
    element.name = encodeURIComponent(this.data.fieldName);
    element.disabled = this.data.readOnly;
    element.type = 'radio';
    if (this.data.fieldValue === this.data.buttonValue) {
      element.setAttribute('checked', true);
    }

    this.container.style.fontSize = this.container.style.height;

    this.container.appendChild(element);
    this.container.appendChild(document.createElement('span'));

    return this.container;
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

    let i, ii, option, style;
    let itemName = encodeURIComponent(this.data.fieldName) + '_item';

    if (!this.data.combo) {
      let selectElement = document.createElement('select');
      selectElement.name = encodeURIComponent(this.data.fieldName);
      selectElement.disabled = this.data.readOnly;

      style = selectElement.style;

      this._setElementFont(selectElement);

      this._setBackgroundColor(
        selectElement,
        this.data.backgroundColor,
        this.layer.className,
        this.container.className);

      // List boxes have a size and (optionally) multiple selection.
      selectElement.size = this.data.options.length;

      if (this.data.multiSelect) {
        selectElement.multiple = true;
      }

      // Insert the options into the choice field.
      for (i = 0, ii = this.data.options.length; i < ii; i++) {
        option = this.data.options[i];

        let optionElement = document.createElement('option');
        optionElement.textContent = option.displayValue;
        optionElement.value = option.exportValue;
        optionElement.setAttribute('name', itemName);

        if (this.data.fieldValue.indexOf(option.displayValue) >= 0) {
          optionElement.setAttribute('selected', true);
        }

        selectElement.appendChild(optionElement);
      }

      this.container.appendChild(selectElement);
    } else {
      let comboElementDiv = document.createElement('div');
      comboElementDiv.className = 'combo';
      comboElementDiv.style.height = this.container.style.height;

      let comboElement = document.createElement('input');
      comboElement.type = 'text';
      comboElement.readOnly = true;
      comboElement.name = encodeURIComponent(this.data.fieldName);
      comboElement.style.height = this.container.style.height;
      comboElement.style.width = this.container.style.width;

      style = comboElement.style;

      let self = this;

      this._setElementFont(comboElement);

      this._setBackgroundColor(
        comboElement,
        this.data.backgroundColor,
        this.layer.className,
        this.container.className);

      let comboContent = document.createElement('div');
      comboContent.className = 'combo-content';

      comboElement.onblur = function() {
        if (!this.selected) {
          comboContent.classList.remove('show');
          self.container.style.position = '';
          self.container.style.zIndex = '';
        }
      };

      let spanElement = document.createElement('span');
      spanElement.onclick = function() {
        if (!comboElement.disabled) {
          comboElement.focus();
          comboContent.classList.toggle('show');
          self.container.style.position = 'absolute';
          self.container.style.zIndex = '100';
        }
      };

      let comboWidth = parseFloat(self.container.style.width);
      let increaseComboWidth = false;

      let outer = document.createElement('div');
      outer.style.visibility = 'hidden';
      outer.style.width = '100px';
      outer.style.msOverflowStyle = 'scrollbar'; // needed for WinJS apps

      document.body.appendChild(outer);

      let widthNoScroll = outer.offsetWidth;
      // force scrollbars
      outer.style.overflow = 'scroll';

      // add innerdiv
      let inner = document.createElement('div');
      inner.style.width = '100%';
      outer.appendChild(inner);

      let widthWithScroll = inner.offsetWidth;

      // remove divs
      outer.parentNode.removeChild(outer);
      let scrollbarWidth = 0; // widthNoScroll - widthWithScroll;

      for (i = 0, ii = this.data.options.length; i < ii; i++) {
        option = this.data.options[i];

        var aElement = document.createElement('a');
        aElement.setAttribute('value', option.exportValue);
        aElement.text = option.displayValue;
        aElement.name = itemName;

        var aElementWidth = self._measureText(aElement.text,
            (style.fontStyle ? style.fontStyle + ' ' : '') +
            (style.fontWeight ? style.fontWeight + ' ' : '') +
            (style.fontSize ? style.fontSize : '9') + 'px ' +
            (style.fontFamily || self._getDefaultFontName()));

        if (aElementWidth.width + scrollbarWidth > comboWidth) {
          comboWidth = aElementWidth.width;
          increaseComboWidth = true;
        }

        aElement.onclick = function() {
          comboElement.value = this.text;
          comboElement.select();
          comboContent.classList.remove('show');
          self.container.style.position = '';
          self.container.style.zIndex = '';

          // Auto size
          if (comboElement.autoSize) {
            let maxHeight = parseInt(self.container.style.height);

            let fSize = 2;
            for (fSize = 2; fSize < maxHeight - 2; fSize += 0.2) {
              let m = self._measureText(this.text,
                (style.fontStyle ? style.fontStyle + ' ' : '') +
                (style.fontWeight ? style.fontWeight + ' ' : '') +
                fSize + 'px ' +
                (style.fontFamily || self._getDefaultFontName()));

              if (m.width > parseInt(self.container.style.width)) {
                break;
              }
            }

            style.fontSize = --fSize + 'px';
          }
        };

        aElement.onmouseover = function() {
          comboElement.selected = true;
        };

        aElement.onmouseout = function() {
          comboElement.selected = false;
        };

        comboContent.append(aElement);
      }

      if (increaseComboWidth) {
        comboContent.style.width = comboWidth + scrollbarWidth + 'px';
      }

      if (!style.fontSize) {
        comboElement.autoSize = true;
        style.fontSize = '9px';
      }

      comboElementDiv.append(comboElement);
      comboElementDiv.append(spanElement);
      comboElementDiv.append(comboContent);

      this.container.append(comboElementDiv);
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
      style.fontSize = this.data.fontSize + 'px';
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
    const IGNORE_TYPES = ['Line'];

    this.container.className = 'popupAnnotation';

    if (IGNORE_TYPES.indexOf(this.data.parentType) >= 0) {
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
      contents: this.data.contents,
    });

    // Position the popup next to the parent annotation's container.
    // PDF viewers ignore a popup annotation's rectangle.
    let parentLeft = parseFloat(parentElement.style.left);
    let parentWidth = parseFloat(parentElement.style.width);
    CustomStyle.setProp('transformOrigin', this.container,
                        -(parentLeft + parentWidth) + 'px -' +
                        parentElement.style.top);
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

    let contents = this._formatContents(this.contents);
    let title = document.createElement('h1');
    title.textContent = this.title;

    // Attach the event listeners to the trigger element.
    this.trigger.addEventListener('click', this._toggle.bind(this));
    this.trigger.addEventListener('mouseover', this._show.bind(this, false));
    this.trigger.addEventListener('mouseout', this._hide.bind(this, false));
    popup.addEventListener('click', this._hide.bind(this, true));

    popup.appendChild(title);
    popup.appendChild(contents);
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
    const SVG_NS = 'http://www.w3.org/2000/svg';

    this.container.className = 'lineAnnotation';

    // Create an invisible line with the same starting and ending coordinates
    // that acts as the trigger for the popup. Only the line itself should
    // trigger the popup, not the entire container.
    let data = this.data;
    let width = data.rect[2] - data.rect[0];
    let height = data.rect[3] - data.rect[1];

    let svg = document.createElementNS(SVG_NS, 'svg:svg');
    svg.setAttributeNS(null, 'version', '1.1');
    svg.setAttributeNS(null, 'width', width + 'px');
    svg.setAttributeNS(null, 'height', height + 'px');
    svg.setAttributeNS(null, 'preserveAspectRatio', 'none');
    svg.setAttributeNS(null, 'viewBox', '0 0 ' + width + ' ' + height);

    // PDF coordinates are calculated from a bottom left origin, so transform
    // the line coordinates to a top left origin for the SVG element.
    let line = document.createElementNS(SVG_NS, 'svg:line');
    line.setAttributeNS(null, 'x1', data.rect[2] - data.lineCoordinates[0]);
    line.setAttributeNS(null, 'y1', data.rect[3] - data.lineCoordinates[1]);
    line.setAttributeNS(null, 'x2', data.rect[2] - data.lineCoordinates[2]);
    line.setAttributeNS(null, 'y2', data.rect[3] - data.lineCoordinates[3]);
    line.setAttributeNS(null, 'stroke-width', data.borderStyle.width);
    line.setAttributeNS(null, 'stroke', 'transparent');

    svg.appendChild(line);
    this.container.append(svg);

    // Create the popup ourselves so that we can bind it to the line instead
    // of to the entire container (which is the default).
    this._createPopup(this.container, line, this.data);

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

class FileAttachmentAnnotationElement extends AnnotationElement {
  constructor(parameters) {
    super(parameters, /* isRenderable = */ true);

    let file = this.data.file;
    this.filename = getFilenameFromUrl(file.filename);
    this.content = file.content;

    this.linkService.onFileAttachmentAnnotation({
      id: stringToPDFString(file.filename),
      filename: file.filename,
      content: file.content,
    });
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
 * @property {string} imageResourcesPath
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
        imageResourcesPath: parameters.imageResourcesPath ||
                            getDefaultSetting('imageResourcesPath'),
        renderInteractiveForms: parameters.renderInteractiveForms || false,
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
        CustomStyle.setProp('transform', element,
          'matrix(' + parameters.viewport.transform.join(',') + ')');
      }
    }
    parameters.div.removeAttribute('hidden');
  }
}

export {
  AnnotationLayer,
};
