import { useCallback, type ChangeEvent } from "react";

import type { CardContent } from "../../lib/export/cardContent";
import type { CardLayout, CardSize, ImageFormat } from "../../lib/ipc/cardExportClient";
import { ColorField } from "../shared/ColorField";
import { SegmentedControl } from "../shared/SegmentedControl";
import { BACKGROUNDS, FIELDS, FORMATS, LAYOUTS, SIZES, SWATCHES, type CardBackground, type CardFieldOption } from "./cardOptions";

interface ImageExportControlsProps {
  readonly layout: CardLayout;
  readonly onLayout: (layout: CardLayout) => void;
  readonly size: CardSize;
  readonly onSize: (size: CardSize) => void;
  readonly content: CardContent;
  readonly onField: (key: keyof CardContent, value: string) => void;
  readonly background: CardBackground;
  readonly onBackground: (background: CardBackground) => void;
  readonly cardColor: string;
  readonly onCardColor: (color: string) => void;
  readonly showMark: boolean;
  readonly onShowMark: (show: boolean) => void;
  readonly format: ImageFormat;
  readonly onFormat: (format: ImageFormat) => void;
}

/** The image dialog's choices: layout, size, words, background, mark and format. */
export function ImageExportControls(props: ImageExportControlsProps) {
  const { layout, size, content, background, cardColor, showMark, format, onSize, onShowMark } = props;
  const changeSize = useCallback((event: ChangeEvent<HTMLSelectElement>) => onSize(event.target.value as CardSize), [onSize]);
  const changeMark = useCallback((event: ChangeEvent<HTMLInputElement>) => onShowMark(event.target.checked), [onShowMark]);
  return (
    <div className="image-export__controls">
      <div className="image-export__control">
        <span id="card-layout-label">Layout</span>
        <SegmentedControl name="card-layout" labelledBy="card-layout-label" options={LAYOUTS} value={layout} onChange={props.onLayout} />
      </div>
      <label className="image-export__control">
        <span>Size</span>
        <select value={size} onChange={changeSize}>
          {SIZES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {FIELDS[layout].map((field) => (
        <CardField key={field.key} field={field} value={content[field.key]} onChange={props.onField} />
      ))}
      <div className="image-export__control">
        <span id="card-background-label">Background</span>
        <SegmentedControl
          name="card-background"
          labelledBy="card-background-label"
          options={BACKGROUNDS}
          value={background}
          onChange={props.onBackground}
        />
        {background === "color" ? <CardColors color={cardColor} onChange={props.onCardColor} /> : null}
      </div>
      <label className="image-export__check">
        <input type="checkbox" checked={showMark} onChange={changeMark} />
        <span>Compose mark</span>
      </label>
      <div className="image-export__control">
        <span id="card-format-label">Format</span>
        <SegmentedControl name="card-format" labelledBy="card-format-label" options={FORMATS} value={format} onChange={props.onFormat} />
      </div>
    </div>
  );
}

function CardColors({ color, onChange }: { readonly color: string; readonly onChange: (color: string) => void }) {
  return (
    <div className="image-export__colors">
      {SWATCHES.map((swatch) => (
        <SwatchButton key={swatch.color} color={swatch.color} name={swatch.name} selected={swatch.color === color} onPick={onChange} />
      ))}
      <ColorField value={color} onChange={onChange} label="Card colour" />
    </div>
  );
}

interface SwatchButtonProps {
  readonly color: string;
  readonly name: string;
  readonly selected: boolean;
  readonly onPick: (color: string) => void;
}

function SwatchButton({ color, name, selected, onPick }: SwatchButtonProps) {
  const pick = useCallback(() => onPick(color), [onPick, color]);
  return (
    <button
      type="button"
      className="image-export__swatch"
      style={{ background: color }}
      aria-label={name}
      aria-pressed={selected}
      title={name}
      onClick={pick}
    />
  );
}

interface CardFieldProps {
  readonly field: CardFieldOption;
  readonly value: string;
  readonly onChange: (field: keyof CardContent, value: string) => void;
}

function CardField({ field, value, onChange }: CardFieldProps) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(field.key, event.target.value),
    [field.key, onChange],
  );
  return (
    <label className="image-export__control">
      <span>{field.label}</span>
      {field.multiline ? <textarea rows={4} value={value} onChange={handleChange} /> : <input type="text" value={value} onChange={handleChange} />}
    </label>
  );
}
