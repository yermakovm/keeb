# keeb — pinout

Split keyboard on XIAO nRF52840-compatible ("Super nRF52840") boards.
Both halves share this pinout; the MCP23017 matrix expander sits on `i2c1`
(address `0x20`).

## nRF52840 (XIAO header)

| XIAO pin | nRF pin | Use                        | Notes                                                                                                              |
| -------- | ------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D0       | P0.02   | Matrix row 0               | Freed from the status LED (LED now lives on the expander, GPB5–GPB7)                                               |
| D1       | P0.03   | Matrix row 1               |                                                                                                                    |
| D2       | P0.28   | Matrix row 2               |                                                                                                                    |
| D3       | P0.29   | Matrix row 3               |                                                                                                                    |
| D6       | P1.11   | Matrix row 4               | Was `uart0` TX (uart0 disabled)                                                                                   |
| D9       | P1.14   | Matrix row 5               | Was `SPIM_MISO` in the board's `spi2` pinctrl — keeb.dtsi re-points spi2 at trimmed groups without MISO (write-only display)      |
| D4       | P0.04   | I2C SDA → MCP23017         | `i2c1`                                                                                                             |
| D5       | P0.05   | I2C SCL → MCP23017         | `i2c1`                                                                                                             |
| D7       | P1.12   | nice!view SPI CS           | `spi2` CS (`&xiao_spi` `cs-gpios`)                                                                                 |
| D8       | P1.13   | nice!view SPI SCK          | `spi2`                                                                                                             |
| D10      | P1.15   | nice!view SPI MOSI         | `spi2`                                                                                                             |

## MCP23017 (I2C addr 0x20)

| Pin         | Use                                         | Notes                                        |
| ----------- | ------------------------------------------- | -------------------------------------------- |
| GPA0–GPA5   | Matrix cols 0–5                             | Outputs, driven active-high during scan     |
| GPA6–GPA7   | free                                        |                                              |
| GPB0–GPB4   | free                                        |                                              |
| GPB5–GPB7   | Status RGB LED (KY-016: R→B5, G→B6, B→B7)  | Common cathode, module pin `−` to GND       |