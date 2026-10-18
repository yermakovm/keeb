/*
 * keeb power diagnostics: NologoTech "Super nRF52840" (XIAO nRF52840 clone).
 *
 * These boards have no regulator documentation. Measured GPIO-high tracks
 * the battery (4.0V fresh, 3.6V settled) instead of a regulated rail, and
 * the nRF52840 has THREE things that can cause that:
 *   1. DCDCEN0 left =1 by the bootloader (Zephyr never clears it, see
 *      zephyr/soc/nordic/nrf52/soc.c - it only *sets* it when reg0 is okay),
 *      with the clone missing the REG0 buck inductor -> unregulated VDD.
 *   2. VDD tied to VDDH on the PCB -> VDD = battery, nothing firmware can do.
 *   3. A regulated-but-different-than-assumed REGOUT0 (1.8V erased default
 *      vs 3.3V) - this logs which.
 *
 * This logs the state inherited from the bootloader and (when
 * CONFIG_KBEEB_POWER_FORCE_LDO) deterministically switches both stages to
 * LDO, which on this hardware is the only mode that provably regulates.
 */
#include <zephyr/init.h>
#include <zephyr/logging/log.h>
#include <cmsis_core.h>

LOG_MODULE_REGISTER(keeb_power, CONFIG_LOG_DEFAULT_LEVEL);

#if !defined(NRF_POWER) || !defined(POWER_DCDCEN0_DCDCEN_Msk)
#error "keeb power diagnostics only make sense on nRF52 POWER (this board)"
#endif

#include <hal/nrf_power.h>

static int keeb_power_diag(void)
{
	/* REG0: VDDH -> VDD stage (LDO level set by UICR REGOUT0). */
	const bool dcdc0 = nrf_power_dcdcen_vddh_get(NRF_POWER);
	/* REG1: VDD -> core stage (LDO 1.8V always available). */
	const bool dcdc1 = nrf_power_dcdcen_get(NRF_POWER);
	const uint32_t vout = (NRF_UICR->REGOUT0 & UICR_REGOUT0_VOUT_Msk) >>
			      UICR_REGOUT0_VOUT_Pos;
	static const char *const vout_str[] = { "1.8", "2.1", "2.4",
						"2.7", "3.0", "3.3",
						"resv", "default(1.8)" };

	LOG_WRN("keeb power: REG0(VDDH->VDD) mode=%s REGOUT0=%s V, "
		"REG1(VDD->core) mode=%s",
		dcdc0 ? "DCDC(unregulated if no inductor!)" : "LDO", vout_str[vout],
		dcdc1 ? "DCDC" : "LDO");

	if (IS_ENABLED(CONFIG_KBEEB_POWER_FORCE_LDO)) {
		nrf_power_dcdcen_vddh_set(NRF_POWER, false);
		nrf_power_dcdcen_set(NRF_POWER, false);
		LOG_WRN("keeb power: forced both stages to LDO "
			"(now DCDCEN0=%d DCDCEN=%d)",
			(int)nrf_power_dcdcen_vddh_get(NRF_POWER),
			(int)nrf_power_dcdcen_get(NRF_POWER));
	}

	return 0;
}
/* After soc.c's own init (PRE_KERNEL_1 prio 0) so our force wins. */
SYS_INIT(keeb_power_diag, PRE_KERNEL_1, 90);